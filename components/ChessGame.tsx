"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MqttClient } from "mqtt";
import { Chess, Move, Color, BoardT, PieceType, isW, toSAN, encodeMoves, decodeGame } from "@/lib/engine";
import { bestMove } from "@/lib/ai";
import { playMoveSound, tick } from "@/lib/sound";
import Board from "@/components/Board";
import SidePanel, { Result, OnlineState } from "@/components/SidePanel";

const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const FULL: Record<PieceType, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

// Free public MQTT-over-WebSocket relay: no account, no key, works on any network.
const BROKER = "wss://broker.emqx.io:8084/mqtt";
const TOPIC = (room: string) => `chessnext/v1/${room}`;

type Msg =
  | { t: "join"; s: string }
  | { t: "state"; s: string; moves: Move[] }
  | { t: "move"; s: string; move: Move }
  | { t: "reset"; s: string };

type Outgoing =
  | { t: "join" }
  | { t: "state"; moves: Move[] }
  | { t: "move"; move: Move }
  | { t: "reset" };

function snapshot(g: Chess): BoardT {
  return g.board.map((r) => r.slice());
}

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
    const before = g.clone();
    const after = g.clone();
    after.applyMove(m);
    hist.push({ san: toSAN(before, m, after), move: m });
    g.applyMove(m);
  }
  return hist;
}

export default function ChessGame() {
  const engineRef = useRef<Chess>(new Chess());
  const posCountsRef = useRef<Record<string, number>>({});
  const soundRef = useRef(true);
  const toastTimer = useRef<number | undefined>(undefined);
  const startedRef = useRef(false);

  // multiplayer refs
  const clientRef = useRef<MqttClient | null>(null);
  const roomRef = useRef<string>("");
  const myId = useRef<string>(Math.random().toString(36).slice(2)).current;
  const ackedRef = useRef(false);
  const applyingRemote = useRef(false);
  const historyRef = useRef<{ san: string; move: Move }[]>([]);
  const onlineRef = useRef<OnlineState>(null);

  const [position, setPosition] = useState<BoardT>(() => snapshot(engineRef.current));
  const [turn, setTurn] = useState<Color>("w");
  const [lastMove, setLastMove] = useState<{ from: [number, number]; to: [number, number] } | null>(null);
  const [checkSquare, setCheckSquare] = useState<[number, number] | null>(null);
  const [history, setHistory] = useState<{ san: string; move: Move }[]>([]);
  const [gameOver, setGameOver] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const [mode, setMode] = useState<"human" | "ai">("human");
  const [aiSide, setAiSide] = useState<Color>("b");
  const [difficulty, setDifficulty] = useState(2);
  const [orientation, setOrientation] = useState<Color>("w");
  const [soundOn, setSoundOn] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [locked, setLocked] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [online, setOnline] = useState<OnlineState>(null);

  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { onlineRef.current = online; }, [online]);

  const publish = useCallback((msg: Outgoing) => {
    const c = clientRef.current;
    if (c && roomRef.current) c.publish(TOPIC(roomRef.current), JSON.stringify({ ...msg, s: myId }));
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

  const evaluateEnd = useCallback((): boolean => {
    const g = engineRef.current;
    const legal = g.legalMoves(g.turn);
    if (legal.length === 0) {
      if (g.inCheck(g.turn)) setResult({ title: "Checkmate", sub: (g.turn === "w" ? "Black" : "White") + " wins" });
      else setResult({ title: "Stalemate", sub: "Draw — no legal moves" });
      setGameOver(true);
      return true;
    }
    if (g.half >= 100) { setResult({ title: "Draw", sub: "Fifty-move rule" }); setGameOver(true); return true; }
    if (g.insufficientMaterial()) { setResult({ title: "Draw", sub: "Insufficient material" }); setGameOver(true); return true; }
    if ((posCountsRef.current[g.key()] ?? 0) >= 3) { setResult({ title: "Draw", sub: "Threefold repetition" }); setGameOver(true); return true; }
    return false;
  }, []);

  const makeMove = useCallback((m: Move) => {
    const g = engineRef.current;
    const before = g.clone();
    const after = g.clone();
    after.applyMove(m);
    const san = toSAN(before, m, after);

    g.applyMove(m);
    const k = g.key();
    posCountsRef.current[k] = (posCountsRef.current[k] ?? 0) + 1;

    setHistory((h) => [...h, { san, move: m }]);
    setLastMove({ from: m.from, to: m.to });
    refreshDerived();

    const over = evaluateEnd();
    playMoveSound(m, !over && g.inCheck(g.turn), over, soundRef.current);

    if (onlineRef.current?.status === "connected" && !applyingRemote.current) {
      publish({ t: "move", move: m });
    }
  }, [refreshDerived, evaluateEnd, publish]);

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
    setHistory(moves);
    setLastMove(last);
    setGameOver(false);
    setResult(null);
    setThinking(false);
    setPosition(snapshot(g));
    setTurn(g.turn);
    setCheckSquare(g.inCheck(g.turn) ? g.findKing(g.turn) : null);
  }, []);

  // ---- multiplayer over an MQTT relay ----
  const connectRoom = useCallback(async (room: string, role: "host" | "guest") => {
    const { default: mqtt } = await import("mqtt");
    clientRef.current?.end(true);
    ackedRef.current = false;
    roomRef.current = room;

    setMode("human");
    setLocked(false);
    resetTo([]);
    setOrientation(role === "host" ? "w" : "b");
    setOnline({ role, myColor: role === "host" ? "w" : "b", status: "waiting" });

    const client = mqtt.connect(BROKER, {
      clientId: "chess_" + myId,
      keepalive: 30,
      clean: true,
      reconnectPeriod: 2000,
    });
    clientRef.current = client;

    client.on("connect", () => {
      client.subscribe(TOPIC(room), () => publish({ t: "join" }));
    });

    client.on("message", (_topic, payload) => {
      let msg: Msg;
      try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch { return; }
      if (!msg || msg.s === myId) return;

      // make sure the other side also learns about us (order-independent handshake)
      if (!ackedRef.current) { ackedRef.current = true; publish({ t: "join" }); }

      if (msg.t === "join") {
        setOnline((o) => (o ? { ...o, status: "connected" } : o));
        if (role === "host") publish({ t: "state", moves: historyRef.current.map((h) => h.move) });
      } else if (msg.t === "state") {
        resetTo(replayMoves(msg.moves));
        setOnline((o) => (o ? { ...o, status: "connected" } : o));
      } else if (msg.t === "move") {
        applyingRemote.current = true;
        makeMove(msg.move);
        applyingRemote.current = false;
      } else if (msg.t === "reset") {
        resetTo([]);
      }
    });

    client.on("error", () => showToast("Network hiccup — reconnecting…"));
  }, [resetTo, makeMove, publish, showToast, myId]);

  const startHost = useCallback(async () => {
    const room = Math.random().toString(36).slice(2, 8);
    await connectRoom(room, "host");
    const url = `${window.location.origin}${window.location.pathname}#live=${room}`;
    window.history.replaceState(null, "", `#live=${room}`);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => showToast("🔗 Invite link copied — send it to your friend"))
        .catch(() => showToast(url));
    } else {
      showToast(url);
    }
  }, [connectRoom, showToast]);

  const joinGame = useCallback((room: string) => connectRoom(room, "guest"), [connectRoom]);

  const leaveOnline = useCallback(() => {
    clientRef.current?.end(true);
    clientRef.current = null;
    roomRef.current = "";
    onlineRef.current = null;
    setOnline(null);
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  // Load shared/live game from the URL once on first mount.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const hash = window.location.hash;
    if (hash.startsWith("#live=")) {
      joinGame(hash.slice(6));
      return;
    }
    if (hash.startsWith("#g=")) {
      try {
        const { game, history: h } = decodeGame(decodeURIComponent(hash.slice(3)));
        engineRef.current = game;
        posCountsRef.current = {};
        posCountsRef.current[game.key()] = 1;
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

  // Computer plays when it is its turn (never during an online game).
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
    if (!online && window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    setLocked(false);
    resetTo([]);
    if (onlineRef.current?.status === "connected") publish({ t: "reset" });
  }, [resetTo, online, publish]);

  const flip = () => setOrientation((o) => (o === "w" ? "b" : "w"));

  const undo = useCallback(() => {
    if (online) return; // disabled during live play to avoid desync
    if (history.length === 0) return;
    const keep = history.slice(0, history.length - 1);
    while (mode === "ai" && keep.length > 0 && (keep.length % 2 === 0 ? "w" : "b") === aiSide) {
      keep.pop();
    }
    resetTo(keep);
  }, [history, mode, aiSide, resetTo, online]);

  const chooseMode = (m: "human" | "ai") => { leaveOnline(); setMode(m); setLocked(false); resetTo([]); };
  const chooseSide = (you: Color) => {
    setAiSide(you === "w" ? "b" : "w");
    setOrientation(you);
    setLocked(false);
    resetTo([]);
  };
  const toggleSound = () => {
    setSoundOn((s) => {
      soundRef.current = !s;
      if (!s) tick(true);
      return !s;
    });
  };

  const share = useCallback(() => {
    const code = encodeMoves(history.map((h) => h.move));
    const url = `${window.location.origin}${window.location.pathname}#g=${code}`;
    window.history.replaceState(null, "", `#g=${code}`);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url)
        .then(() => showToast("🔗 Snapshot link copied (view-only position)"))
        .catch(() => showToast(url));
    } else {
      showToast(url);
    }
  }, [history, showToast]);

  const unlock = () => setLocked(false);

  const legalFor = useCallback((r: number, c: number): Move[] => {
    const g = engineRef.current;
    return g.legalMoves(g.turn).filter((m) => m.from[0] === r && m.from[1] === c);
  }, []);

  // captured pieces + material advantage
  const remain: Record<Color, Partial<Record<PieceType, number>>> = { w: {}, b: {} };
  for (const row of position)
    for (const p of row)
      if (p) {
        const col: Color = isW(p) ? "w" : "b";
        const t = p.toLowerCase() as PieceType;
        remain[col][t] = (remain[col][t] ?? 0) + 1;
      }
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

  const interactive =
    !gameOver && !locked &&
    (online
      ? online.status === "connected" && turn === online.myColor
      : !(mode === "ai" && turn === aiSide));
  const inCheck = checkSquare !== null;

  return (
    <div className="app">
      <div className="board-area">
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
      </div>

      <SidePanel
        mode={mode}
        onMode={chooseMode}
        youPlay={aiSide === "w" ? "b" : "w"}
        onSide={chooseSide}
        difficulty={difficulty}
        onDifficulty={setDifficulty}
        turn={turn}
        inCheck={inCheck}
        thinking={thinking}
        gameOver={gameOver}
        result={result}
        locked={locked}
        onUnlock={unlock}
        online={online}
        onInvite={startHost}
        onLeaveOnline={leaveOnline}
        capturedByWhite={capturedByWhite}
        capturedByBlack={capturedByBlack}
        advantage={advantage}
        history={history}
        soundOn={soundOn}
        onToggleSound={toggleSound}
        onNew={newGame}
        onFlip={flip}
        onUndo={undo}
        onShare={share}
      />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
