"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MqttClient } from "mqtt";
import { Chess, Move, Color, BoardT, PieceType, isW, toSAN, decodeGame } from "@/lib/engine";
import { bestMove } from "@/lib/ai";
import { playMoveSound, playChat, tick } from "@/lib/sound";
import { Lang, tr } from "@/lib/i18n";
import Board from "@/components/Board";
import SidePanel, { GameResult, OnlineState, TcId } from "@/components/SidePanel";
import Chat, { ChatMsg } from "@/components/Chat";

const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const FULL: Record<PieceType, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

const BROKER = "wss://broker.emqx.io:8084/mqtt";
const TOPIC = (room: string) => `chessnext/v1/${room}`;
const QOS = 1 as const;

const TCS: Record<TcId, { base: number; inc: number } | null> = {
  none: null,
  "3+2": { base: 180000, inc: 2000 },
  "5+0": { base: 300000, inc: 0 },
  "10+0": { base: 600000, inc: 0 },
};

type Rematch = "none" | "sent" | "received";
type Clocks = { w: number; b: number };

type Msg =
  | { t: "join"; s: string }
  | { t: "state"; s: string; moves: Move[]; tcId: TcId; clocks?: Clocks }
  | { t: "move"; s: string; move: Move; ply: number; clocks?: Clocks }
  | { t: "resync"; s: string }
  | { t: "rematch"; s: string }
  | { t: "rematch-accept"; s: string }
  | { t: "rematch-decline"; s: string }
  | { t: "chat"; s: string; text: string; quick: boolean; color?: string }
  | { t: "tc"; s: string; tcId: TcId }
  | { t: "flag"; s: string; loser: Color };

type Outgoing =
  | { t: "join" }
  | { t: "state"; moves: Move[]; tcId: TcId; clocks?: Clocks }
  | { t: "move"; move: Move; ply: number; clocks?: Clocks }
  | { t: "resync" }
  | { t: "rematch" }
  | { t: "rematch-accept" }
  | { t: "rematch-decline" }
  | { t: "chat"; text: string; quick: boolean; color?: string }
  | { t: "tc"; tcId: TcId }
  | { t: "flag"; loser: Color };

function snapshot(g: Chess): BoardT { return g.board.map((r) => r.slice()); }

function replayMoves(moves: Move[]): { san: string; move: Move }[] {
  const g = new Chess();
  const hist: { san: string; move: Move }[] = [];
  for (const mv of moves) {
    const m = g.legalMoves(g.turn).find(
      (x) => x.from[0] === mv.from[0] && x.from[1] === mv.from[1] &&
        x.to[0] === mv.to[0] && x.to[1] === mv.to[1] &&
        (mv.promotion ? x.promotion === mv.promotion : true)
    );
    if (!m) break;
    const before = g.clone(); const after = g.clone(); after.applyMove(m);
    hist.push({ san: toSAN(before, m, after), move: m });
    g.applyMove(m);
  }
  return hist;
}

function fmtClock(ms: number): string {
  const s = Math.max(0, ms / 1000);
  if (s >= 60) { const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return m + ":" + String(sec).padStart(2, "0"); }
  return s.toFixed(1);
}

export default function ChessGame() {
  const engineRef = useRef<Chess>(new Chess());
  const posCountsRef = useRef<Record<string, number>>({});
  const soundRef = useRef(true);
  const toastTimer = useRef<number | undefined>(undefined);
  const startedRef = useRef(false);

  const clientRef = useRef<MqttClient | null>(null);
  const roomRef = useRef<string>("");
  const myId = useRef<string>(Math.random().toString(36).slice(2)).current;
  const ackedRef = useRef(false);
  const applyingRemote = useRef(false);
  const historyRef = useRef<{ san: string; move: Move }[]>([]);
  const onlineRef = useRef<OnlineState>(null);
  const rematchRef = useRef<Rematch>("none");
  const langRef = useRef<Lang>("en");
  const plyRef = useRef(0);

  const clockRef = useRef<Clocks>({ w: 0, b: 0 });
  const tcIdRef = useRef<TcId>("none");
  const lastTickRef = useRef<number>(0);
  const countedRef = useRef(false);
  const turnRef = useRef<Color>("w");
  const gameOverRef = useRef(false);
  const lockedRef = useRef(false);

  const [position, setPosition] = useState<BoardT>(() => snapshot(engineRef.current));
  const [turn, setTurn] = useState<Color>("w");
  const [lastMove, setLastMove] = useState<{ from: [number, number]; to: [number, number] } | null>(null);
  const [checkSquare, setCheckSquare] = useState<[number, number] | null>(null);
  const [history, setHistory] = useState<{ san: string; move: Move }[]>([]);
  const [gameOver, setGameOver] = useState(false);
  const [result, setResult] = useState<GameResult | null>(null);

  const [mode, setMode] = useState<"human" | "ai">("human");
  const [aiSide, setAiSide] = useState<Color>("b");
  const [difficulty, setDifficulty] = useState(2);
  const [orientation, setOrientation] = useState<Color>("w");
  const [soundOn, setSoundOn] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [locked, setLocked] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [online, setOnline] = useState<OnlineState>(null);
  const [rematch, setRematch] = useState<Rematch>("none");
  const [lang, setLang] = useState<Lang>("en");
  const [tcId, setTcId] = useState<TcId>("none");
  const [clock, setClock] = useState<Clocks>({ w: 0, b: 0 });
  const [score, setScore] = useState<{ w: number; b: number }>({ w: 0, b: 0 });
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [showResult, setShowResult] = useState(false);

  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { onlineRef.current = online; }, [online]);
  useEffect(() => { rematchRef.current = rematch; }, [rematch]);
  useEffect(() => { langRef.current = lang; }, [lang]);
  useEffect(() => { turnRef.current = turn; }, [turn]);
  useEffect(() => { gameOverRef.current = gameOver; }, [gameOver]);
  useEffect(() => { lockedRef.current = locked; }, [locked]);
  useEffect(() => { if (gameOver) setShowResult(true); }, [gameOver]);

  useEffect(() => {
    const saved = window.localStorage.getItem("chess-lang");
    if (saved === "fr" || saved === "en") setLang(saved);
  }, []);
  useEffect(() => { window.localStorage.setItem("chess-lang", lang); }, [lang]);

  const publish = useCallback((msg: Outgoing) => {
    const c = clientRef.current;
    if (c && roomRef.current) c.publish(TOPIC(roomRef.current), JSON.stringify({ ...msg, s: myId }), { qos: QOS });
  }, [myId]);

  const showToast = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const refreshDerived = useCallback(() => {
    const g = engineRef.current;
    setPosition(snapshot(g));
    setTurn(g.turn);
    setCheckSquare(g.inCheck(g.turn) ? g.findKing(g.turn) : null);
  }, []);

  const finish = useCallback((r: GameResult) => {
    if (countedRef.current) return;
    countedRef.current = true;
    setResult(r);
    setGameOver(true);
    if (r.kind === "checkmate" || r.kind === "timeout") {
      const w = r.winner;
      setScore((s) => ({ ...s, [w]: s[w] + 1 }));
    }
  }, []);

  const evaluateEnd = useCallback((): GameResult | null => {
    const g = engineRef.current;
    const legal = g.legalMoves(g.turn);
    if (legal.length === 0) return g.inCheck(g.turn) ? { kind: "checkmate", winner: g.turn === "w" ? "b" : "w" } : { kind: "stalemate" };
    if (g.half >= 100) return { kind: "draw", reason: "fifty" };
    if (g.insufficientMaterial()) return { kind: "draw", reason: "insufficient" };
    if ((posCountsRef.current[g.key()] ?? 0) >= 3) return { kind: "draw", reason: "threefold" };
    return null;
  }, []);

  const makeMove = useCallback((m: Move) => {
    const g = engineRef.current;
    const mover = g.turn;
    const before = g.clone(); const after = g.clone(); after.applyMove(m);
    const san = toSAN(before, m, after);

    g.applyMove(m);
    plyRef.current += 1;
    const k = g.key();
    posCountsRef.current[k] = (posCountsRef.current[k] ?? 0) + 1;

    const tc = TCS[tcIdRef.current];
    if (tc && !applyingRemote.current) {
      clockRef.current = { ...clockRef.current, [mover]: clockRef.current[mover] + tc.inc };
      setClock(clockRef.current);
    }

    setHistory((h) => [...h, { san, move: m }]);
    setLastMove({ from: m.from, to: m.to });
    refreshDerived();

    const r = evaluateEnd();
    if (r) finish(r);
    playMoveSound(m, !r && g.inCheck(g.turn), !!r, soundRef.current);

    if (onlineRef.current?.status === "connected" && !applyingRemote.current) {
      publish({ t: "move", move: m, ply: plyRef.current, clocks: tc ? { ...clockRef.current } : undefined });
    }
  }, [refreshDerived, evaluateEnd, finish, publish]);

  const resetTo = useCallback((moves: { san: string; move: Move }[]) => {
    const g = new Chess();
    posCountsRef.current = {};
    posCountsRef.current[g.key()] = 1;
    let last: { from: [number, number]; to: [number, number] } | null = null;
    for (const item of moves) {
      g.applyMove(item.move);
      posCountsRef.current[g.key()] = (posCountsRef.current[g.key()] ?? 0) + 1;
      last = { from: item.move.from, to: item.move.to };
    }
    engineRef.current = g;
    plyRef.current = moves.length;
    const base = TCS[tcIdRef.current]?.base ?? 0;
    clockRef.current = { w: base, b: base };
    lastTickRef.current = performance.now();
    countedRef.current = false;
    setClock({ w: base, b: base });
    setHistory(moves);
    setLastMove(last);
    setGameOver(false);
    setResult(null);
    setShowResult(false);
    setThinking(false);
    setPosition(snapshot(g));
    setTurn(g.turn);
    setCheckSquare(g.inCheck(g.turn) ? g.findKing(g.turn) : null);
  }, []);

  const flagTimeout = useCallback((loser: Color) => {
    if (countedRef.current) return;
    finish({ kind: "timeout", winner: loser === "w" ? "b" : "w" });
    if (onlineRef.current?.status === "connected") publish({ t: "flag", loser });
  }, [finish, publish]);

  useEffect(() => {
    lastTickRef.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;
      const tc = TCS[tcIdRef.current];
      if (!tc) return;
      if (gameOverRef.current || lockedRef.current) return;
      if (onlineRef.current && onlineRef.current.status !== "connected") return;
      const side = turnRef.current;
      const next = { ...clockRef.current };
      next[side] = Math.max(0, next[side] - dt);
      clockRef.current = next;
      setClock(next);
      if (next[side] <= 0) flagTimeout(side);
    }, 200);
    return () => clearInterval(id);
  }, [flagTimeout]);

  useEffect(() => {
    tcIdRef.current = tcId;
    const base = TCS[tcId]?.base ?? 0;
    clockRef.current = { w: base, b: base };
    lastTickRef.current = performance.now();
    setClock({ w: base, b: base });
    if (onlineRef.current?.role === "host" && onlineRef.current.status === "connected") publish({ t: "tc", tcId });
  }, [tcId, publish]);

  const connectRoom = useCallback(async (room: string, role: "host" | "guest") => {
    const { default: mqtt } = await import("mqtt");
    clientRef.current?.end(true);
    ackedRef.current = false;
    roomRef.current = room;

    setMode("human");
    setLocked(false);
    setRematch("none");
    setChat([]);
    setScore({ w: 0, b: 0 });
    resetTo([]);
    setOrientation(role === "host" ? "w" : "b");
    setOnline({ role, myColor: role === "host" ? "w" : "b", status: "waiting" });

    const client = mqtt.connect(BROKER, { clientId: "chess_" + myId, keepalive: 30, clean: true, reconnectPeriod: 2000 });
    clientRef.current = client;

    client.on("connect", () => {
      client.subscribe(TOPIC(room), { qos: QOS }, () => publish({ t: "join" }));
    });

    client.on("message", (_topic, payload) => {
      let msg: Msg;
      try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch { return; }
      if (!msg || msg.s === myId) return;
      if (!ackedRef.current) { ackedRef.current = true; publish({ t: "join" }); }

      if (msg.t === "join") {
        setOnline((o) => (o ? { ...o, status: "connected" } : o));
        if (role === "host") publish({ t: "state", moves: historyRef.current.map((h) => h.move), tcId: tcIdRef.current, clocks: { ...clockRef.current } });
      } else if (msg.t === "state") {
        if (msg.moves.length >= plyRef.current) {
          if (msg.tcId) setTcId(msg.tcId);
          resetTo(replayMoves(msg.moves));
          if (msg.clocks) { clockRef.current = msg.clocks; setClock(msg.clocks); }
        }
        setOnline((o) => (o ? { ...o, status: "connected" } : o));
      } else if (msg.t === "move") {
        const expected = plyRef.current + 1;
        if (msg.ply === expected) {
          applyingRemote.current = true;
          makeMove(msg.move);
          applyingRemote.current = false;
          if (msg.clocks) { clockRef.current = msg.clocks; setClock(msg.clocks); }
        } else if (msg.ply > expected) {
          publish({ t: "resync" }); // we missed something — pull full state
        }
      } else if (msg.t === "resync") {
        publish({ t: "state", moves: historyRef.current.map((h) => h.move), tcId: tcIdRef.current, clocks: { ...clockRef.current } });
      } else if (msg.t === "tc") {
        setTcId(msg.tcId);
      } else if (msg.t === "flag") {
        finish({ kind: "timeout", winner: msg.loser === "w" ? "b" : "w" });
      } else if (msg.t === "chat") {
        setChat((c) => [...c, { from: "them", text: msg.text, quick: msg.quick, color: msg.color }]);
        playChat(soundRef.current);
      } else if (msg.t === "rematch") {
        if (rematchRef.current === "sent") { resetTo([]); publish({ t: "rematch-accept" }); setRematch("none"); }
        else setRematch("received");
      } else if (msg.t === "rematch-accept") {
        resetTo([]); setRematch("none");
      } else if (msg.t === "rematch-decline") {
        setRematch("none"); showToast(tr(langRef.current, "declined"));
      }
    });

    client.on("error", () => showToast(tr(langRef.current, "netHiccup")));
  }, [resetTo, makeMove, publish, showToast, finish, myId]);

  const startHost = useCallback(async () => {
    const room = Math.random().toString(36).slice(2, 8);
    await connectRoom(room, "host");
    const url = `${window.location.origin}${window.location.pathname}#live=${room}`;
    window.history.replaceState(null, "", `#live=${room}`);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(() => showToast(tr(langRef.current, "inviteCopied"))).catch(() => showToast(url));
    else showToast(url);
  }, [connectRoom, showToast]);

  const joinGame = useCallback((room: string) => connectRoom(room, "guest"), [connectRoom]);

  const leaveOnline = useCallback(() => {
    clientRef.current?.end(true);
    clientRef.current = null;
    roomRef.current = "";
    onlineRef.current = null;
    setOnline(null);
    setRematch("none");
    setChat([]);
    setScore({ w: 0, b: 0 });
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const hash = window.location.hash;
    if (hash.startsWith("#live=")) { joinGame(hash.slice(6)); return; }
    if (hash.startsWith("#g=")) {
      try {
        const { game, history: h } = decodeGame(decodeURIComponent(hash.slice(3)));
        engineRef.current = game;
        posCountsRef.current = {};
        posCountsRef.current[game.key()] = 1;
        plyRef.current = h.length;
        setHistory(h);
        setLastMove(h.length ? { from: h[h.length - 1].move.from, to: h[h.length - 1].move.to } : null);
        setLocked(true);
        refreshDerived();
        return;
      } catch { /* fall through */ }
    }
    posCountsRef.current[engineRef.current.key()] = 1;
  }, [joinGame, refreshDerived]);

  useEffect(() => () => { clientRef.current?.end(true); }, []);

  useEffect(() => {
    if (online || mode !== "ai" || gameOver || locked || turn !== aiSide) return;
    setThinking(true);
    const id = setTimeout(() => {
      const m = bestMove(engineRef.current, difficulty);
      if (m) makeMove(m);
      setThinking(false);
    }, 60);
    return () => clearTimeout(id);
  }, [turn, mode, aiSide, gameOver, locked, difficulty, online, makeMove]);

  const newGame = useCallback(() => {
    if (onlineRef.current?.status === "connected") { publish({ t: "rematch" }); setRematch("sent"); return; }
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    setLocked(false);
    resetTo([]);
  }, [resetTo, publish]);

  const acceptRematch = useCallback(() => { publish({ t: "rematch-accept" }); resetTo([]); setRematch("none"); }, [publish, resetTo]);
  const declineRematch = useCallback(() => { publish({ t: "rematch-decline" }); setRematch("none"); }, [publish]);

  const flip = () => setOrientation((o) => (o === "w" ? "b" : "w"));

  const undo = useCallback(() => {
    if (online) return;
    if (history.length === 0) return;
    const keep = history.slice(0, history.length - 1);
    while (mode === "ai" && keep.length > 0 && (keep.length % 2 === 0 ? "w" : "b") === aiSide) keep.pop();
    resetTo(keep);
  }, [history, mode, aiSide, resetTo, online]);

  const chooseMode = (m: "human" | "ai") => { leaveOnline(); setMode(m); setLocked(false); setScore({ w: 0, b: 0 }); resetTo([]); };
  const chooseSide = (you: Color) => { setAiSide(you === "w" ? "b" : "w"); setOrientation(you); setLocked(false); setScore({ w: 0, b: 0 }); resetTo([]); };
  const toggleSound = () => setSoundOn((s) => { soundRef.current = !s; if (!s) tick(true); return !s; });
  const unlock = () => setLocked(false);

  const sendChat = useCallback((text: string, quick: boolean, color?: string) => {
    const clean = text.trim().slice(0, 200);
    if (!clean) return;
    setChat((c) => [...c, { from: "me", text: clean, quick, color }]);
    publish({ t: "chat", text: clean, quick, color });
    playChat(soundRef.current);
  }, [publish]);

  const legalFor = useCallback((r: number, c: number): Move[] => {
    const g = engineRef.current;
    return g.legalMoves(g.turn).filter((m) => m.from[0] === r && m.from[1] === c);
  }, []);

  const remain: Record<Color, Partial<Record<PieceType, number>>> = { w: {}, b: {} };
  for (const row of position)
    for (const p of row)
      if (p) { const col: Color = isW(p) ? "w" : "b"; const t = p.toLowerCase() as PieceType; remain[col][t] = (remain[col][t] ?? 0) + 1; }
  const capturedByWhite: PieceType[] = [];
  const capturedByBlack: PieceType[] = [];
  (["q", "r", "b", "n", "p"] as PieceType[]).forEach((k) => {
    const missingBlack = FULL[k] - (remain.b[k] ?? 0);
    const missingWhite = FULL[k] - (remain.w[k] ?? 0);
    for (let i = 0; i < missingBlack; i++) capturedByWhite.push(k);
    for (let i = 0; i < missingWhite; i++) capturedByBlack.push(k);
  });
  let matW = 0, matB = 0;
  (Object.keys(remain.w) as PieceType[]).forEach((k) => (matW += VAL[k] * (remain.w[k] ?? 0)));
  (Object.keys(remain.b) as PieceType[]).forEach((k) => (matB += VAL[k] * (remain.b[k] ?? 0)));
  const advantage = matW - matB;

  const inProgress = history.length > 0 && !gameOver;
  const interactive =
    !gameOver && !locked &&
    (online ? online.status === "connected" && turn === online.myColor : !(mode === "ai" && turn === aiSide));
  const inCheck = checkSquare !== null;
  const timed = tcId !== "none";

  const bottomColor: Color = orientation;
  const topColor: Color = orientation === "w" ? "b" : "w";
  const labelFor = (c: Color): string => {
    if (online) return c === online.myColor ? tr(lang, "you") : tr(lang, "opponent");
    if (mode === "ai") return c === aiSide ? tr(lang, "computer") : tr(lang, "you");
    return c === "w" ? tr(lang, "white") : tr(lang, "black");
  };
  const canShowTurn = !gameOver && !(online && online.status !== "connected");
  const Tag = ({ c }: { c: Color }) => {
    const active = canShowTurn && turn === c;
    const low = timed && clock[c] < 10000;
    return (
      <div className={"player" + (active ? " active" : "")}>
        <span className={"turn-dot " + c} />
        <span className="pname">{labelFor(c)}</span>
        <span className="pscore">{score[c]}</span>
        {timed
          ? <span className={"pclock" + (low ? " low" : "") + (active ? " run" : "")}>{fmtClock(clock[c])}</span>
          : active && <span className="tomove">● {tr(lang, "toMove")}</span>}
      </div>
    );
  };

  // result modal view
  let modalTitle = "";
  let modalTone = "draw";
  if (result) {
    if (result.kind === "draw" || result.kind === "stalemate") { modalTitle = tr(lang, "draw"); modalTone = "draw"; }
    else {
      const w = result.winner;
      const iWin = online ? w === online.myColor : mode === "ai" ? w !== aiSide : null;
      if (iWin === true) { modalTitle = tr(lang, "youWin"); modalTone = "win"; }
      else if (iWin === false) { modalTitle = tr(lang, "youLose"); modalTone = "lose"; }
      else { modalTitle = w === "w" ? tr(lang, "whiteWins") : tr(lang, "blackWins"); modalTone = "win"; }
    }
  }
  let modalSub = "";
  if (result) {
    if (result.kind === "checkmate") modalSub = tr(lang, "checkmate");
    else if (result.kind === "timeout") modalSub = tr(lang, "timesUp");
    else if (result.kind === "stalemate") modalSub = tr(lang, "stalemateSub");
    else modalSub = result.reason === "fifty" ? tr(lang, "fifty") : result.reason === "insufficient" ? tr(lang, "insufficient") : tr(lang, "threefold");
  }

  return (
    <div className={"app" + (online ? " with-chat" : "")}>
      <div className="lang-toggle">
        <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
        <button className={lang === "fr" ? "on" : ""} onClick={() => setLang("fr")}>FR</button>
      </div>

      {online && <Chat lang={lang} chat={chat} onSend={sendChat} />}

      <div className="board-area">
        <div className="board-stack">
          <Tag c={topColor} />
          <Board
            position={position}
            orientation={orientation}
            turn={turn}
            lastMove={lastMove}
            checkSquare={checkSquare}
            interactive={interactive}
            legalFor={legalFor}
            onMove={makeMove}
          />
          <Tag c={bottomColor} />
        </div>
      </div>

      <SidePanel
        lang={lang}
        mode={mode}
        onMode={chooseMode}
        youPlay={aiSide === "w" ? "b" : "w"}
        onSide={chooseSide}
        difficulty={difficulty}
        onDifficulty={setDifficulty}
        tcId={tcId}
        onTcId={setTcId}
        settingsLocked={inProgress}
        turn={turn}
        inCheck={inCheck}
        thinking={thinking}
        gameOver={gameOver}
        result={result}
        locked={locked}
        onUnlock={unlock}
        online={online}
        rematch={rematch}
        onInvite={startHost}
        onLeaveOnline={leaveOnline}
        onRematchAccept={acceptRematch}
        onRematchDecline={declineRematch}
        capturedByWhite={capturedByWhite}
        capturedByBlack={capturedByBlack}
        advantage={advantage}
        history={history}
        soundOn={soundOn}
        onToggleSound={toggleSound}
        onNew={newGame}
        onFlip={flip}
        onUndo={undo}
      />

      {gameOver && showResult && result && (
        <div className="modal-overlay" onClick={() => setShowResult(false)}>
          <div className={"modal " + modalTone} onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{modalTitle}</div>
            <div className="modal-sub">{modalSub}</div>
            <div className="modal-score">
              <span className="turn-dot w" /> {score.w}
              <span className="dash">–</span>
              {score.b} <span className="turn-dot b" />
            </div>
            <div className="modal-btns">
              <button className="primary" onClick={() => { setShowResult(false); newGame(); }}>
                {online ? tr(lang, "rematch") : tr(lang, "newGame")}
              </button>
              <button onClick={() => setShowResult(false)}>{tr(lang, "close")}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
