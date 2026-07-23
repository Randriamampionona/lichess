"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DataConnection, Peer as PeerType } from "peerjs";
import {
  Chess,
  Move,
  Color,
  BoardT,
  PieceType,
  isW,
  toSAN,
  encodeMoves,
  decodeGame,
} from "@/lib/engine";
import { bestMove } from "@/lib/ai";
import { playMoveSound, tick } from "@/lib/sound";
import Board from "@/components/Board";
import SidePanel, { Result, OnlineState } from "@/components/SidePanel";

const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const FULL: Record<PieceType, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

type Msg =
  | { type: "move"; move: Move }
  | { type: "state"; moves: Move[] }
  | { type: "reset" };

function snapshot(g: Chess): BoardT {
  return g.board.map((r) => r.slice());
}

// rebuild {san,move}[] from bare Move[] received over the wire
function replayMoves(moves: Move[]): { san: string; move: Move }[] {
  const g = new Chess();
  const hist: { san: string; move: Move }[] = [];
  for (const mv of moves) {
    const m = g
      .legalMoves(g.turn)
      .find(
        (x) =>
          x.from[0] === mv.from[0] &&
          x.from[1] === mv.from[1] &&
          x.to[0] === mv.to[0] &&
          x.to[1] === mv.to[1] &&
          (mv.promotion ? x.promotion === mv.promotion : true),
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
  const peerRef = useRef<PeerType | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const applyingRemote = useRef(false);
  const historyRef = useRef<{ san: string; move: Move }[]>([]);
  const onlineRef = useRef<OnlineState>(null);

  const [position, setPosition] = useState<BoardT>(() =>
    snapshot(engineRef.current),
  );
  const [turn, setTurn] = useState<Color>("w");
  const [lastMove, setLastMove] = useState<{
    from: [number, number];
    to: [number, number];
  } | null>(null);
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

  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
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
      if (g.inCheck(g.turn))
        setResult({
          title: "Checkmate",
          sub: (g.turn === "w" ? "Black" : "White") + " wins",
        });
      else setResult({ title: "Stalemate", sub: "Draw — no legal moves" });
      setGameOver(true);
      return true;
    }
    if (g.half >= 100) {
      setResult({ title: "Draw", sub: "Fifty-move rule" });
      setGameOver(true);
      return true;
    }
    if (g.insufficientMaterial()) {
      setResult({ title: "Draw", sub: "Insufficient material" });
      setGameOver(true);
      return true;
    }
    if ((posCountsRef.current[g.key()] ?? 0) >= 3) {
      setResult({ title: "Draw", sub: "Threefold repetition" });
      setGameOver(true);
      return true;
    }
    return false;
  }, []);

  const makeMove = useCallback(
    (m: Move) => {
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

      // relay local moves to the connected peer
      if (
        onlineRef.current?.status === "connected" &&
        !applyingRemote.current
      ) {
        connRef.current?.send({ type: "move", move: m } as Msg);
      }
    },
    [refreshDerived, evaluateEnd],
  );

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

  // ---- multiplayer (WebRTC via peerjs, free public broker, no backend) ----
  const handleRemote = useCallback(
    (raw: unknown) => {
      const data = raw as Msg;
      if (data.type === "move") {
        applyingRemote.current = true;
        makeMove(data.move);
        applyingRemote.current = false;
      } else if (data.type === "state") {
        resetTo(replayMoves(data.moves));
      } else if (data.type === "reset") {
        resetTo([]);
      }
    },
    [makeMove, resetTo],
  );

  const setupConn = useCallback(
    (conn: DataConnection) => {
      connRef.current = conn;
      conn.on("data", handleRemote);
      conn.on("close", () =>
        setOnline((o) => (o ? { ...o, status: "disconnected" } : o)),
      );
      conn.on("error", () =>
        setOnline((o) => (o ? { ...o, status: "disconnected" } : o)),
      );
    },
    [handleRemote],
  );

  const startHost = useCallback(async () => {
    const { default: Peer } = await import("peerjs");
    peerRef.current?.destroy();
    const id = "chess-" + Math.random().toString(36).slice(2, 8);
    const peer = new Peer(id);
    peerRef.current = peer;
    setLocked(false);
    setMode("human");
    resetTo([]);
    setOrientation("w");
    setOnline({ role: "host", myColor: "w", status: "waiting" });
    peer.on("open", (pid: string) => {
      const url = `${window.location.origin}${window.location.pathname}#live=${pid}`;
      window.history.replaceState(null, "", `#live=${pid}`);
      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(url)
          .then(() =>
            showToast("🔗 Invite link copied — send it to your friend"),
          )
          .catch(() => showToast(url));
      } else {
        showToast(url);
      }
    });
    peer.on("connection", (conn: DataConnection) => {
      setupConn(conn);
      conn.on("open", () => {
        conn.send({
          type: "state",
          moves: historyRef.current.map((h) => h.move),
        } as Msg);
        setOnline((o) => (o ? { ...o, status: "connected" } : o));
      });
    });
    peer.on("error", () => showToast("Connection error — please try again"));
  }, [resetTo, setupConn, showToast]);

  const joinGame = useCallback(
    async (hostId: string) => {
      const { default: Peer } = await import("peerjs");
      peerRef.current?.destroy();
      const peer = new Peer();
      peerRef.current = peer;
      setLocked(false);
      setMode("human");
      resetTo([]);
      setOrientation("b");
      setOnline({ role: "guest", myColor: "b", status: "waiting" });
      peer.on("open", () => {
        const conn = peer.connect(hostId, { reliable: true });
        setupConn(conn);
        conn.on("open", () =>
          setOnline((o) => (o ? { ...o, status: "connected" } : o)),
        );
      });
      peer.on("error", () =>
        showToast("Could not connect — the host may be offline"),
      );
    },
    [resetTo, setupConn, showToast],
  );

  const leaveOnline = useCallback(() => {
    peerRef.current?.destroy();
    peerRef.current = null;
    connRef.current = null;
    onlineRef.current = null;
    setOnline(null);
    if (window.location.hash)
      window.history.replaceState(null, "", window.location.pathname);
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
        const { game, history: h } = decodeGame(
          decodeURIComponent(hash.slice(3)),
        );
        engineRef.current = game;
        posCountsRef.current = {};
        posCountsRef.current[game.key()] = 1;
        setHistory(h);
        setLastMove(
          h.length
            ? { from: h[h.length - 1].move.from, to: h[h.length - 1].move.to }
            : null,
        );
        setLocked(true);
        refreshDerived();
        return;
      } catch {
        /* fall through */
      }
    }
    posCountsRef.current[engineRef.current.key()] = 1;
  }, [joinGame, refreshDerived]);

  useEffect(
    () => () => {
      peerRef.current?.destroy();
    },
    [],
  );

  // Computer plays when it is its turn (never during an online game).
  useEffect(() => {
    if (online || mode !== "ai" || gameOver || locked || turn !== aiSide)
      return;
    setThinking(true);
    const id = setTimeout(() => {
      const m = bestMove(engineRef.current, difficulty);
      if (m) makeMove(m);
      setThinking(false);
    }, 60);
    return () => clearTimeout(id);
  }, [turn, mode, aiSide, gameOver, locked, difficulty, online, makeMove]);

  const newGame = useCallback(() => {
    if (!online && window.location.hash)
      window.history.replaceState(null, "", window.location.pathname);
    setLocked(false);
    resetTo([]);
    if (onlineRef.current?.status === "connected")
      connRef.current?.send({ type: "reset" } as Msg);
  }, [resetTo, online]);

  const flip = () => setOrientation((o) => (o === "w" ? "b" : "w"));

  const undo = useCallback(() => {
    if (online) return; // undo is disabled during a live game to avoid desync
    if (history.length === 0) return;
    const keep = history.slice(0, history.length - 1);
    while (
      mode === "ai" &&
      keep.length > 0 &&
      (keep.length % 2 === 0 ? "w" : "b") === aiSide
    ) {
      keep.pop();
    }
    resetTo(keep);
  }, [history, mode, aiSide, resetTo, online]);

  const chooseMode = (m: "human" | "ai") => {
    leaveOnline();
    setMode(m);
    setLocked(false);
    resetTo([]);
  };
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
      navigator.clipboard
        .writeText(url)
        .then(() => showToast("🔗 Snapshot link copied (view-only position)"))
        .catch(() => showToast(url));
    } else {
      showToast(url);
    }
  }, [history, showToast]);

  const unlock = () => setLocked(false);

  const legalFor = useCallback((r: number, c: number): Move[] => {
    const g = engineRef.current;
    return g
      .legalMoves(g.turn)
      .filter((m) => m.from[0] === r && m.from[1] === c);
  }, []);

  // captured pieces + material advantage
  const remain: Record<Color, Partial<Record<PieceType, number>>> = {
    w: {},
    b: {},
  };
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
  let matW = 0,
    matB = 0;
  (Object.keys(remain.w) as PieceType[]).forEach(
    (k) => (matW += VAL[k] * (remain.w[k] ?? 0)),
  );
  (Object.keys(remain.b) as PieceType[]).forEach(
    (k) => (matB += VAL[k] * (remain.b[k] ?? 0)),
  );
  const advantage = matW - matB;

  const interactive =
    !gameOver &&
    !locked &&
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
