"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MqttClient } from "mqtt";
import {
  Chess,
  Move,
  Color,
  BoardT,
  PieceType,
  isW,
  toSAN,
  decodeGame,
} from "@/lib/engine";
import { bestMove } from "@/lib/ai";
import { playMoveSound, playChat, speak, tick } from "@/lib/sound";
import { Lang, tr, TKey } from "@/lib/i18n";
import Board from "@/components/Board";
import SidePanel, {
  GameResult,
  OnlineState,
  Role,
  TcId,
} from "@/components/SidePanel";
import Chat, { ChatMsg, QuickSend } from "@/components/Chat";
import Navbar from "@/components/Navbar";
import {
  watchAuth,
  signInWithGoogle,
  signOut,
  ensureProfile,
  watchProfile,
  setNickname,
  Profile,
} from "@/lib/account";
import {
  createGame,
  joinGame,
  applyRating,
  GameResult as FbResult,
} from "@/lib/gameStore";
import Confetti from "./Confetti";

const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const FULL: Record<PieceType, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

const BROKER = "wss://broker.emqx.io:8084/mqtt";
const TOPIC = (room: string) => `chessnext/v1/${room}`;
const QOS = 1 as const;
// presence tuning
const FREEZE_GAP = 4000; // if two watchdog ticks are >4s apart, THIS tab was suspended — don't blame the peer
const PEER_STALE = 12000; // peer silent this long (while we're awake) → show "reconnecting…"
const PEER_LEAVE = 60000; // peer silent this long (while we're awake) → declare they left

const TCS: Record<TcId, { base: number; inc: number } | null> = {
  none: null,
  "3+2": { base: 180000, inc: 2000 },
  "5+0": { base: 300000, inc: 0 },
  "10+0": { base: 600000, inc: 0 },
};

const ADJ = [
  "Swift",
  "Brave",
  "Sneaky",
  "Royal",
  "Clever",
  "Lucky",
  "Silent",
  "Bold",
  "Mighty",
  "Wily",
  "Cosmic",
  "Rapid",
];
const NOUN = [
  "Knight",
  "Rook",
  "Bishop",
  "Pawn",
  "Queen",
  "Gambit",
  "Castle",
  "Mate",
  "Endgame",
  "Bishop",
  "Falcon",
  "Comet",
];
const randomNick = () =>
  ADJ[Math.floor(Math.random() * ADJ.length)] +
  NOUN[Math.floor(Math.random() * NOUN.length)] +
  Math.floor(Math.random() * 90 + 10);

type Rematch = "none" | "sent" | "received";
type Clocks = { w: number; b: number };
type Player = { id: string; nick: string };
type Roster = { white: Player; black: Player | null };

type Msg =
  | { t: "join"; s: string; id: string; nick: string }
  | { t: "roster"; s: string; white: Player; black: Player | null }
  | {
      t: "state";
      s: string;
      moves: Move[];
      tcId: TcId;
      clocks?: Clocks;
      score?: { w: number; b: number };
    }
  | { t: "move"; s: string; move: Move; ply: number; clocks?: Clocks }
  | { t: "resync"; s: string }
  | { t: "tc"; s: string; tcId: TcId }
  | { t: "timeout"; s: string; loser: Color }
  | { t: "rematch"; s: string }
  | { t: "takeback"; s: string }
  | { t: "takeback-accept"; s: string }
  | { t: "takeback-decline"; s: string }
  | { t: "rematch-accept"; s: string }
  | { t: "rematch-decline"; s: string }
  | { t: "resign"; s: string }
  | { t: "resign-accept"; s: string; winner: Color }
  | { t: "resign-decline"; s: string }
  | {
      t: "chat";
      s: string;
      nick: string;
      quick: boolean;
      key?: TKey;
      text?: string;
      color?: string;
    }
  | { t: "cursor"; s: string; x: number; y: number; o: Color }
  | { t: "nick"; s: string; id: string; nick: string }
  | {
      t: "ping";
      s: string;
      ply: number;
      key: string;
      ts?: number;
      rtt?: number;
    }
  | { t: "pong"; s: string; ts: number }
  | { t: "result"; s: string; result: GameResult }
  | { t: "left"; s: string; id: string; explicit?: boolean };

type Outgoing =
  | { t: "join"; id: string; nick: string }
  | { t: "roster"; white: Player; black: Player | null }
  | {
      t: "state";
      moves: Move[];
      tcId: TcId;
      clocks?: Clocks;
      score?: { w: number; b: number };
    }
  | { t: "move"; move: Move; ply: number; clocks?: Clocks }
  | { t: "resync" }
  | { t: "tc"; tcId: TcId }
  | { t: "timeout"; loser: Color }
  | { t: "rematch" }
  | { t: "takeback" }
  | { t: "takeback-accept" }
  | { t: "takeback-decline" }
  | { t: "rematch-accept" }
  | { t: "rematch-decline" }
  | { t: "resign" }
  | { t: "resign-accept"; winner: Color }
  | { t: "resign-decline" }
  | {
      t: "chat";
      nick: string;
      quick: boolean;
      key?: TKey;
      text?: string;
      color?: string;
    }
  | { t: "cursor"; x: number; y: number; o: Color }
  | { t: "nick"; id: string; nick: string }
  | { t: "ping"; ply: number; key: string; ts?: number; rtt?: number }
  | { t: "pong"; ts: number }
  | { t: "result"; result: GameResult }
  | { t: "left"; id: string; explicit?: boolean };

function snapshot(g: Chess): BoardT {
  return g.board.map((r) => r.slice());
}

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

function fmtClock(ms: number): string {
  const s = Math.max(0, ms / 1000);
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ":" + String(sec).padStart(2, "0");
  }
  return s.toFixed(1);
}

const SESSION_KEY = "chess-live-session";
type SavedSession = {
  room: string;
  isHost: boolean;
  nick: string;
  tcId: TcId;
  moves: Move[];
  score: { w: number; b: number };
};
function saveSession(d: SavedSession) {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(d));
  } catch {
    /* noop */
  }
}
function loadSession(): SavedSession | null {
  try {
    const s = window.localStorage.getItem(SESSION_KEY);
    return s ? (JSON.parse(s) as SavedSession) : null;
  } catch {
    return null;
  }
}
function clearSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}

function PingBars({ rtt }: { rtt: number | null }) {
  const level =
    rtt == null ? 0 : rtt < 120 ? 4 : rtt < 300 ? 3 : rtt < 600 ? 2 : 1;
  const color =
    level >= 3
      ? "#6fce7d"
      : level === 2
        ? "#e5a35b"
        : level === 1
          ? "#e5603c"
          : "#6b6560";
  const heights = [5, 8, 11, 14];
  return (
    <span
      className="ping-bars"
      title={rtt == null ? "…" : `${Math.round(rtt)} ms`}
    >
      {heights.map((h, i) => (
        <span
          key={i}
          style={{
            height: h,
            background: i < level ? color : "rgba(255,255,255,0.15)",
          }}
        />
      ))}
    </span>
  );
}

export default function ChessGame() {
  const engineRef = useRef<Chess>(new Chess());
  const posCountsRef = useRef<Record<string, number>>({});
  const soundRef = useRef(true);
  const toastTimer = useRef<number | undefined>(undefined);
  const startedRef = useRef(false);

  const clientRef = useRef<MqttClient | null>(null);
  const roomRef = useRef<string>("");
  const myIdRef = useRef<string | null>(null);
  if (myIdRef.current === null) {
    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem("chess-id")
        : null;
    myIdRef.current = stored || Math.random().toString(36).slice(2);
    if (typeof window !== "undefined" && !stored)
      window.localStorage.setItem("chess-id", myIdRef.current);
  }
  const myId = myIdRef.current;
  const ackedRef = useRef(false);
  const applyingRemote = useRef(false);
  const historyRef = useRef<{ san: string; move: Move }[]>([]);
  const onlineRef = useRef<OnlineState>(null);
  const rematchRef = useRef<Rematch>("none");
  const langRef = useRef<Lang>("en");
  const plyRef = useRef(0);
  const rosterRef = useRef<Roster>({
    white: { id: "", nick: "" },
    black: null,
  });
  const myRoleRef = useRef<Role>("w");
  const myNickRef = useRef<string>("");
  const orientationRef = useRef<Color>("w");
  const cursorSentRef = useRef(0);
  const cursorHideRef = useRef<number | undefined>(undefined);
  const isHostRef = useRef(false);
  const scoreRef = useRef({ w: 0, b: 0 });
  const myRttRef = useRef<number | null>(null);
  const lastSeenRef = useRef<Record<string, number>>({});
  const watchdogPrevRef = useRef(0);
  const leftFiredRef = useRef<Record<string, boolean>>({});
  const takebackUsedRef = useRef(0);
  const pendingJoinRef = useRef<string>("");
  const pendingLeaveRef = useRef<number | undefined>(undefined);
  const pendingLeaveIdRef = useRef<string | null>(null);

  const clockRef = useRef<Clocks>({ w: 0, b: 0 });
  const tcIdRef = useRef<TcId>("none");
  const lastTickRef = useRef<number>(0);
  const countedRef = useRef(false);
  const turnRef = useRef<Color>("w");
  const gameOverRef = useRef(false);
  const lockedRef = useRef(false);

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
  const [nickPrompt, setNickPrompt] = useState<{
    isHost: boolean;
    room: string;
  } | null>(null);
  const [nickInput, setNickInput] = useState("");
  const [editingNick, setEditingNick] = useState(false);
  const [nickDraft, setNickDraft] = useState("");
  const [resignIncoming, setResignIncoming] = useState(false);
  const [takebackIncoming, setTakebackIncoming] = useState(false);
  const [takebackPending, setTakebackPending] = useState(false);
  const [leftInfo, setLeftInfo] = useState<{ nick: string } | null>(null);
  const [leaverNick, setLeaverNick] = useState("");
  const [peerAway, setPeerAway] = useState(false);
  const [ping, setPing] = useState<{ w: number | null; b: number | null }>({
    w: null,
    b: null,
  });
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const gameIdRef = useRef<string>(""); // Firestore game id (also used as the MQTT room)
  const ratedRef = useRef(true);
  const [remoteCursor, setRemoteCursor] = useState<{
    x: number;
    y: number;
    label: string;
  } | null>(null);
  const [confetti, setConfetti] = useState(0);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    scoreRef.current = score;
  }, [score]);
  useEffect(() => {
    if (!online || online.status === "disconnected") return;
    saveSession({
      room: roomRef.current,
      isHost: isHostRef.current,
      nick: myNickRef.current,
      tcId,
      moves: history.map((h) => h.move),
      score,
    });
  }, [online, history, score, tcId]);
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);
  useEffect(() => {
    rematchRef.current = rematch;
  }, [rematch]);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  useEffect(() => {
    turnRef.current = turn;
  }, [turn]);
  useEffect(() => {
    gameOverRef.current = gameOver;
  }, [gameOver]);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);
  useEffect(() => {
    orientationRef.current = orientation;
  }, [orientation]);
  useEffect(() => {
    if (gameOver) setShowResult(true);
  }, [gameOver]);
  useEffect(() => {
    if (nickPrompt)
      setNickInput(
        profile?.nickname ||
          (typeof window !== "undefined" &&
            window.localStorage.getItem("chess-nick")) ||
          randomNick(),
      );
  }, [nickPrompt, profile]);

  useEffect(() => {
    const saved = window.localStorage.getItem("chess-lang");
    if (saved === "fr" || saved === "en") {
      setLang(saved);
      return;
    }
    // no saved choice yet → fall back to the browser language
    const nav = navigator.languages?.[0] || navigator.language || "en";
    setLang(nav.toLowerCase().startsWith("fr") ? "fr" : "en");
  }, []);
  useEffect(() => {
    window.localStorage.setItem("chess-lang", lang);
  }, [lang]);

  useEffect(() => {
    let unsubProfile: (() => void) | undefined;
    const unsubAuth = watchAuth(async (u) => {
      unsubProfile?.();
      unsubProfile = undefined;
      if (!u) {
        setProfile(null);
        setAuthReady(true);
        return;
      }
      const p = await ensureProfile(
        u.uid,
        u.displayName || localStorage.getItem("chess-nick") || randomNick(),
        u.email || "",
      );
      setProfile(p);
      myNickRef.current = p.nickname;
      setAuthReady(true);
      try {
        localStorage.setItem("chess-nick", p.nickname);
      } catch {
        /* noop */
      }
      unsubProfile = watchProfile(u.uid, (pp) => {
        if (pp) {
          setProfile(pp);
          myNickRef.current = pp.nickname;
        }
      });
    });
    return () => {
      unsubProfile?.();
      unsubAuth();
    };
  }, []);

  useEffect(() => {
    if (!gameOver || !result) return;
    if (result.kind === "draw" || result.kind === "stalemate") return;
    // did *I* win?
    const iWon = online
      ? online.role !== "spec" && result.winner === online.role
      : mode === "ai"
        ? result.winner !== aiSide
        : false; // local 2-player: no single "me", skip confetti (or handle as you like)
    if (iWon) setConfetti(Date.now());
  }, [gameOver, result, online, mode, aiSide]);

  const publish = useCallback(
    (msg: Outgoing) => {
      const c = clientRef.current;
      if (c && roomRef.current)
        c.publish(TOPIC(roomRef.current), JSON.stringify({ ...msg, s: myId }), {
          qos: QOS,
        });
    },
    [myId],
  );

  // keep the live board name in sync when the profile nickname changes (e.g. renamed from the navbar)
  useEffect(() => {
    if (!profile) return;
    const n = profile.nickname;
    myNickRef.current = n;
    const on = onlineRef.current;
    if (!on || on.role === "spec") return;
    const r = rosterRef.current;
    if (r.white.id === myId) r.white = { ...r.white, nick: n };
    else if (r.black && r.black.id === myId) r.black = { ...r.black, nick: n };
    setOnline((o) =>
      o
        ? { ...o, whiteNick: r.white.nick, blackNick: r.black?.nick ?? null }
        : o,
    );
    if (on.status === "connected") publish({ t: "nick", id: myId, nick: n });
  }, [profile, myId, publish]);

  const showToast = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  const refreshDerived = useCallback(() => {
    const g = engineRef.current;
    setPosition(snapshot(g));
    setTurn(g.turn);
    setCheckSquare(g.inCheck(g.turn) ? g.findKing(g.turn) : null);
  }, []);

  const applyRoster = useCallback(
    (r: Roster) => {
      rosterRef.current = r;
      const role: Role =
        r.white.id === myId
          ? "w"
          : r.black && r.black.id === myId
            ? "b"
            : "spec";
      myRoleRef.current = role;
      const ori: Color = role === "b" ? "b" : "w";
      setOrientation(ori);
      orientationRef.current = ori;
      const status: "waiting" | "connected" = r.black ? "connected" : "waiting";
      setOnline({
        role,
        status,
        whiteNick: r.white.nick,
        blackNick: r.black?.nick ?? null,
      });
    },
    [myId],
  );

  const finish = useCallback((r: GameResult) => {
    if (countedRef.current) return;
    countedRef.current = true;
    setResult(r);
    setGameOver(true);
    if (
      r.kind === "checkmate" ||
      r.kind === "timeout" ||
      r.kind === "abandon"
    ) {
      const w = r.winner;
      setScore((s) => ({ ...s, [w]: s[w] + 1 }));
    }
  }, []);

  const fireLeave = useCallback(
    (id: string, nick: string) => {
      if (leftFiredRef.current[id]) return;
      leftFiredRef.current[id] = true;
      setOnline((o) => (o ? { ...o, status: "disconnected" } : o));
      if (myRoleRef.current === "spec") setLeftInfo({ nick });
      else {
        setLeaverNick(nick);
        finish({ kind: "abandon", winner: myRoleRef.current as Color });
      }
    },
    [finish],
  );

  const evaluateEnd = useCallback((): GameResult | null => {
    const g = engineRef.current;
    const legal = g.legalMoves(g.turn);
    if (legal.length === 0)
      return g.inCheck(g.turn)
        ? { kind: "checkmate", winner: g.turn === "w" ? "b" : "w" }
        : { kind: "stalemate" };
    if (g.half >= 100) return { kind: "draw", reason: "fifty" };
    if (g.insufficientMaterial())
      return { kind: "draw", reason: "insufficient" };
    if ((posCountsRef.current[g.key()] ?? 0) >= 3)
      return { kind: "draw", reason: "threefold" };
    return null;
  }, []);

  const makeMove = useCallback(
    (m: Move) => {
      const g = engineRef.current;
      const mover = g.turn;
      const before = g.clone();
      const after = g.clone();
      after.applyMove(m);
      const san = toSAN(before, m, after);
      g.applyMove(m);
      plyRef.current += 1;
      const k = g.key();
      posCountsRef.current[k] = (posCountsRef.current[k] ?? 0) + 1;

      const tc = TCS[tcIdRef.current];
      if (tc && !applyingRemote.current) {
        clockRef.current = {
          ...clockRef.current,
          [mover]: clockRef.current[mover] + tc.inc,
        };
        setClock(clockRef.current);
      }

      setHistory((h) => [...h, { san, move: m }]);
      setLastMove({ from: m.from, to: m.to });
      refreshDerived();

      const r = evaluateEnd();
      if (r) finish(r);
      playMoveSound(m, !r && g.inCheck(g.turn), !!r, soundRef.current);

      if (
        onlineRef.current?.status === "connected" &&
        myRoleRef.current !== "spec"
      ) {
        if (!applyingRemote.current)
          publish({
            t: "move",
            move: m,
            ply: plyRef.current,
            clocks: tc ? { ...clockRef.current } : undefined,
          });
        if (r) publish({ t: "result", result: r });
      }
    },
    [refreshDerived, evaluateEnd, finish, publish],
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
    plyRef.current = moves.length;
    const base = TCS[tcIdRef.current]?.base ?? 0;
    clockRef.current = { w: base, b: base };
    lastTickRef.current = performance.now();
    countedRef.current = false;
    takebackUsedRef.current = 0;
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

  const flagTimeout = useCallback(
    (loser: Color) => {
      if (countedRef.current) return;
      finish({ kind: "timeout", winner: loser === "w" ? "b" : "w" });
      if (onlineRef.current?.status === "connected")
        publish({ t: "timeout", loser });
    },
    [finish, publish],
  );

  useEffect(() => {
    lastTickRef.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;
      const tc = TCS[tcIdRef.current];
      if (!tc || gameOverRef.current || lockedRef.current) return;
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

  // heartbeat + presence watchdog, driven by a Web Worker so it keeps running
  // even when the tab is hidden/unfocused (main-thread timers get throttled there)
  useEffect(() => {
    watchdogPrevRef.current = performance.now();
    const tick = () => {
      const on = onlineRef.current;
      const now = performance.now();
      const gap = now - watchdogPrevRef.current;
      watchdogPrevRef.current = now;
      if (!on || on.status !== "connected") return;

      // resume heartbeat
      publish({
        t: "ping",
        ply: plyRef.current,
        key: engineRef.current.key(),
        ts: Date.now(),
        rtt: myRttRef.current ?? undefined,
      });

      const r = rosterRef.current;
      const players = [r.white, r.black].filter(Boolean) as {
        id: string;
        nick: string;
      }[];

      // If two ticks were far apart, THIS tab was frozen/suspended (phone locked, long background).
      // We just woke up — don't accuse the peer of leaving. Give everyone a fresh grace and re-sync.
      if (gap > FREEZE_GAP) {
        players.forEach((pl) => {
          lastSeenRef.current[pl.id] = now;
        });
        setPeerAway(false);
        publish({ t: "join", id: myId, nick: myNickRef.current });
        publish({ t: "resync" });
        return;
      }

      // Normal (awake) presence check
      let anyAway = false;
      players.forEach((pl) => {
        if (pl.id === myId) return;
        const seen = lastSeenRef.current[pl.id];
        if (!seen) return;
        const silent = now - seen;
        if (silent > PEER_LEAVE) fireLeave(pl.id, pl.nick);
        else if (silent > PEER_STALE) anyAway = true;
      });
      setPeerAway(anyAway);
    };
    let worker: Worker | null = null;
    let iv: number | undefined;
    try {
      const url = URL.createObjectURL(
        new Blob(["setInterval(function(){postMessage(0)},1000)"], {
          type: "application/javascript",
        }),
      );
      worker = new Worker(url);
      worker.onmessage = tick;
      URL.revokeObjectURL(url);
    } catch {
      // fallback (e.g. strict CSP blocks blob workers): main-thread timer, throttled when hidden
      iv = window.setInterval(tick, 1000);
    }
    return () => {
      if (worker) worker.terminate();
      if (iv) clearInterval(iv);
    };
  }, [publish, fireLeave, myId]);

  // coming back to a tab that may have been frozen: reset timers, reconnect, and resync — never auto-leave
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      watchdogPrevRef.current = performance.now();
      const on = onlineRef.current;
      if (!on || on.status !== "connected") return;
      const now = performance.now();
      const r = rosterRef.current;
      ([r.white, r.black].filter(Boolean) as { id: string }[]).forEach((pl) => {
        lastSeenRef.current[pl.id] = now;
      });
      setPeerAway(false);
      try {
        const c = clientRef.current;
        if (c && !c.connected) c.reconnect();
      } catch {
        /* noop */
      }
      publish({ t: "join", id: myId, nick: myNickRef.current });
      publish({ t: "resync" });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [publish, myId]);

  useEffect(() => {
    tcIdRef.current = tcId;
    const base = TCS[tcId]?.base ?? 0;
    clockRef.current = { w: base, b: base };
    lastTickRef.current = performance.now();
    setClock({ w: base, b: base });
    if (
      onlineRef.current?.role === "w" &&
      onlineRef.current.status === "connected"
    )
      publish({ t: "tc", tcId });
  }, [tcId, publish]);

  const connectRoom = useCallback(
    async (
      room: string,
      isHost: boolean,
      nick: string,
      restore?: { moves: Move[]; score: { w: number; b: number }; tcId: TcId },
    ) => {
      const { default: mqtt } = await import("mqtt");
      clientRef.current?.end(true);
      ackedRef.current = false;
      roomRef.current = room;
      myNickRef.current = nick;
      isHostRef.current = isHost;
      lastSeenRef.current = {};
      leftFiredRef.current = {};
      setLeaverNick("");
      setMode("human");
      setLocked(false);
      setRematch("none");
      setChat([]);
      setResignIncoming(false);
      setLeftInfo(null);
      setRemoteCursor(null);
      setTakebackIncoming(false);
      setTakebackPending(false);
      setLeaverNick("");
      setPeerAway(false);
      myRttRef.current = null;
      setPing({ w: null, b: null });
      if (restore) {
        tcIdRef.current = restore.tcId;
        setTcId(restore.tcId);
        resetTo(replayMoves(restore.moves));
        setScore(restore.score);
      } else {
        setScore({ w: 0, b: 0 });
        resetTo([]);
      }

      if (isHost) {
        rosterRef.current = { white: { id: myId, nick }, black: null };
        applyRoster(rosterRef.current);
      } else {
        // wait for the host to assign us a role via its roster broadcast
        rosterRef.current = { white: { id: "?", nick: "…" }, black: null };
        myRoleRef.current = "b";
        setOrientation("b");
        orientationRef.current = "b";
        setOnline({
          role: "b",
          status: "waiting",
          whiteNick: "…",
          blackNick: null,
        });
      }

      const client = mqtt.connect(BROKER, {
        clientId: "chess_" + myId,
        keepalive: 30,
        clean: true,
        reconnectPeriod: 2000,
        will: {
          topic: TOPIC(room),
          payload: JSON.stringify({ t: "left", id: myId, s: myId }),
          qos: QOS,
          retain: false,
        },
      });
      clientRef.current = client;

      client.on("connect", () => {
        client.subscribe(TOPIC(room), { qos: QOS }, () =>
          publish({ t: "join", id: myId, nick }),
        );
      });

      client.on("message", (_topic, payload) => {
        let msg: Msg;
        try {
          msg = JSON.parse(new TextDecoder().decode(payload));
        } catch {
          return;
        }
        if (!msg || msg.s === myId) return;
        if (msg.t !== "left") lastSeenRef.current[msg.s] = performance.now();
        if (pendingLeaveIdRef.current && msg.s === pendingLeaveIdRef.current) {
          clearTimeout(pendingLeaveRef.current);
          pendingLeaveRef.current = undefined;
          pendingLeaveIdRef.current = null;
        }
        if (!ackedRef.current) {
          ackedRef.current = true;
          publish({ t: "join", id: myId, nick: myNickRef.current });
        }

        if (msg.t === "join") {
          if (pendingLeaveRef.current) {
            clearTimeout(pendingLeaveRef.current);
            pendingLeaveRef.current = undefined;
            pendingLeaveIdRef.current = null;
          }
          if (rosterRef.current.white.id === myId) {
            const r = rosterRef.current;
            if (!r.black && msg.id !== r.white.id)
              r.black = { id: msg.id, nick: msg.nick };
            applyRoster({ white: r.white, black: r.black });
            publish({ t: "roster", white: r.white, black: r.black });
            publish({
              t: "state",
              moves: historyRef.current.map((h) => h.move),
              tcId: tcIdRef.current,
              clocks: { ...clockRef.current },
              score: scoreRef.current,
            });
          } else if (msg.id === rosterRef.current.white.id) {
            publish({ t: "join", id: myId, nick: myNickRef.current });
          }
        } else if (msg.t === "roster") {
          if (pendingLeaveRef.current) {
            clearTimeout(pendingLeaveRef.current);
            pendingLeaveRef.current = undefined;
            pendingLeaveIdRef.current = null;
          }
          if (rosterRef.current.white.id !== myId)
            applyRoster({ white: msg.white, black: msg.black });
        } else if (msg.t === "state") {
          const iAmHost = rosterRef.current.white.id === myId;
          if (!iAmHost && msg.score) setScore(msg.score);
          let adopt = msg.moves.length > plyRef.current;
          if (!adopt && !iAmHost && msg.moves.length === plyRef.current) {
            const g2 = new Chess();
            const rp = replayMoves(msg.moves);
            for (const it of rp) g2.applyMove(it.move);
            adopt = g2.key() !== engineRef.current.key();
          }
          if (adopt) {
            if (msg.tcId) setTcId(msg.tcId);
            resetTo(replayMoves(msg.moves));
            if (msg.clocks) {
              clockRef.current = msg.clocks;
              setClock(msg.clocks);
            }
            const endR = evaluateEnd();
            if (endR) finish(endR);
          }
        } else if (msg.t === "move") {
          const expected = plyRef.current + 1;
          if (msg.ply === expected) {
            applyingRemote.current = true;
            makeMove(msg.move);
            applyingRemote.current = false;
            if (msg.clocks) {
              clockRef.current = msg.clocks;
              setClock(msg.clocks);
            }
          } else if (msg.ply > expected) {
            publish({ t: "resync" });
          }
        } else if (msg.t === "resync") {
          publish({
            t: "state",
            moves: historyRef.current.map((h) => h.move),
            tcId: tcIdRef.current,
            clocks: { ...clockRef.current },
            score: scoreRef.current,
          });
        } else if (msg.t === "ping") {
          const iAmHost = rosterRef.current.white.id === myId;
          // latency: reply with a pong, and record the sender's reported ping for their bar
          if (myRoleRef.current !== "spec" && typeof msg.ts === "number")
            publish({ t: "pong", ts: msg.ts });
          if (typeof msg.rtt === "number") {
            const rttVal = msg.rtt;
            const rr = rosterRef.current;
            const col =
              rr.white.id === msg.s
                ? "w"
                : rr.black && rr.black.id === msg.s
                  ? "b"
                  : null;
            if (col) setPing((pg) => ({ ...pg, [col]: rttVal }));
          }
          if (msg.ply > plyRef.current) publish({ t: "resync" });
          else if (msg.ply < plyRef.current)
            publish({
              t: "state",
              moves: historyRef.current.map((h) => h.move),
              tcId: tcIdRef.current,
              clocks: { ...clockRef.current },
              score: scoreRef.current,
            });
          else if (msg.key && msg.key !== engineRef.current.key()) {
            if (iAmHost)
              publish({
                t: "state",
                moves: historyRef.current.map((h) => h.move),
                tcId: tcIdRef.current,
                clocks: { ...clockRef.current },
                score: scoreRef.current,
              });
            else publish({ t: "resync" });
          }
        } else if (msg.t === "pong") {
          const rtt = Date.now() - msg.ts;
          myRttRef.current = rtt;
          const me = myRoleRef.current;
          if (me === "w" || me === "b") setPing((pg) => ({ ...pg, [me]: rtt }));
        } else if (msg.t === "tc") {
          setTcId(msg.tcId);
        } else if (msg.t === "timeout") {
          finish({ kind: "timeout", winner: msg.loser === "w" ? "b" : "w" });
        } else if (msg.t === "result") {
          finish(msg.result);
          publish({ t: "resync" });
        } else if (msg.t === "chat") {
          setChat((c) => [
            ...c,
            {
              from: "them",
              nick: msg.nick,
              quick: msg.quick,
              key: msg.key,
              text: msg.text,
              color: msg.color,
            },
          ]);
          playChat(soundRef.current);
          if (msg.quick && msg.key)
            speak(
              tr(langRef.current, msg.key),
              langRef.current === "fr" ? "fr-FR" : "en-US",
              soundRef.current,
            );
        } else if (msg.t === "cursor") {
          const r = rosterRef.current;
          const label =
            r.white.id === msg.s
              ? r.white.nick
              : r.black && r.black.id === msg.s
                ? r.black.nick
                : "";
          const flip = msg.o !== orientationRef.current;
          setRemoteCursor({
            x: flip ? 1 - msg.x : msg.x,
            y: flip ? 1 - msg.y : msg.y,
            label,
          });
          if (cursorHideRef.current) clearTimeout(cursorHideRef.current);
          cursorHideRef.current = window.setTimeout(
            () => setRemoteCursor(null),
            2500,
          );
        } else if (msg.t === "nick") {
          const r = rosterRef.current;
          if (r.white.id === msg.id) r.white = { ...r.white, nick: msg.nick };
          else if (r.black && r.black.id === msg.id)
            r.black = { ...r.black, nick: msg.nick };
          setOnline((o) =>
            o
              ? {
                  ...o,
                  whiteNick: r.white.nick,
                  blackNick: r.black?.nick ?? null,
                }
              : o,
          );
        } else if (msg.t === "resign") {
          setResignIncoming(true);
        } else if (msg.t === "resign-accept") {
          setScore((s) => ({ ...s, [msg.winner]: s[msg.winner] + 1 }));
          resetTo([]);
          showToast(tr(langRef.current, "lostByResign"));
        } else if (msg.t === "resign-decline") {
          showToast(tr(langRef.current, "declinedResign"));
        } else if (msg.t === "rematch") {
          if (rematchRef.current === "sent") {
            resetTo([]);
            publish({ t: "rematch-accept" });
            setRematch("none");
          } else setRematch("received");
        } else if (msg.t === "rematch-accept") {
          resetTo([]);
          setRematch("none");
        } else if (msg.t === "rematch-decline") {
          setRematch("none");
          showToast(tr(langRef.current, "declined"));
        } else if (msg.t === "takeback") {
          setTakebackIncoming(true);
        } else if (msg.t === "takeback-accept") {
          setTakebackPending(false);
          takebackUsedRef.current += 1;
          applyTakeback();
        } else if (msg.t === "takeback-decline") {
          setTakebackPending(false);
          showToast(tr(langRef.current, "takebackDeclined"));
        } else if (msg.t === "left") {
          const r = rosterRef.current;
          const isPlayer =
            r.white.id === msg.id || (r.black && r.black.id === msg.id);
          if (isPlayer && msg.explicit) {
            const nick =
              r.white.id === msg.id ? r.white.nick : (r.black?.nick ?? "");
            fireLeave(msg.id, nick);
          }
        }
      });

      client.on("error", () => showToast(tr(langRef.current, "netHiccup")));
    },
    [
      resetTo,
      makeMove,
      publish,
      showToast,
      finish,
      fireLeave,
      evaluateEnd,
      applyRoster,
      myId,
    ],
  );

  const confirmNick = useCallback(async () => {
    const np = nickPrompt;
    if (!np) return;
    const nick = (nickInput.trim() || randomNick()).slice(0, 18);
    try {
      window.localStorage.setItem("chess-nick", nick);
    } catch {
      /* noop */
    }
    setNickPrompt(null);
    myNickRef.current = nick;

    if (np.isHost) {
      let id = np.room; // fallback if profile not ready yet
      if (profile) {
        try {
          id = await createGame(
            { uid: profile.uid, nick, rating: profile.rating },
            tcIdRef.current,
            ratedRef.current,
          );
        } catch {
          /* noop */
        }
      }
      gameIdRef.current = id;
      connectRoom(id, true, nick); // MQTT room = Firestore game id ✅
      const url = `${window.location.origin}${window.location.pathname}#live=${id}`;
      window.history.replaceState(null, "", `#live=${id}`);
      if (navigator.clipboard?.writeText)
        navigator.clipboard
          .writeText(url)
          .then(() => showToast(tr(langRef.current, "inviteCopied")))
          .catch(() => showToast(url));
      else showToast(url);
    } else {
      gameIdRef.current = np.room;
      if (profile) {
        try {
          await joinGame(np.room, {
            uid: profile.uid,
            nick,
            rating: profile.rating,
          });
        } catch {
          /* noop */
        }
      }
      connectRoom(np.room, false, nick);
    }
  }, [nickPrompt, nickInput, connectRoom, showToast, profile]);

  const startHost = useCallback(() => {
    if (!profile) {
      showToast(tr(langRef.current, "signInToPlay"));
      return;
    }
    const room = Math.random().toString(36).slice(2, 8);
    setNickPrompt({ isHost: true, room });
  }, [profile, showToast]);

  const leaveOnline = useCallback(() => {
    if (pendingLeaveRef.current) {
      clearTimeout(pendingLeaveRef.current);
      pendingLeaveRef.current = undefined;
    }
    const c = clientRef.current;
    if (c) {
      publish({ t: "left", id: myId, explicit: true });
      setTimeout(() => {
        try {
          c.end(true);
        } catch {
          /* noop */
        }
      }, 350);
    }
    clientRef.current = null;
    roomRef.current = "";
    onlineRef.current = null;
    rosterRef.current = { white: { id: "", nick: "" }, black: null };
    lastSeenRef.current = {};
    leftFiredRef.current = {};
    clearSession();
    setOnline(null);
    setRematch("none");
    setChat([]);
    setScore({ w: 0, b: 0 });
    setResignIncoming(false);
    setLeftInfo(null);
    setRemoteCursor(null);
    setTakebackIncoming(false);
    setTakebackPending(false);
    setLeaverNick("");
    setPeerAway(false);
    myRttRef.current = null;
    setPing({ w: null, b: null });
    setLeaverNick("");
    resetTo([]);
    if (window.location.hash)
      window.history.replaceState(null, "", window.location.pathname);
  }, [publish, myId, resetTo]);

  const doSignIn = useCallback(() => {
    signInWithGoogle().catch(() =>
      showToast(tr(langRef.current, "signInFailed")),
    );
  }, [showToast]);
  const doSignOut = useCallback(() => {
    leaveOnline();
    signOut().catch(() => {});
  }, [leaveOnline]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const hash = window.location.hash;
    if (hash.startsWith("#live=")) {
      // defer the join until we know the auth state (must be signed in to play)
      pendingJoinRef.current = hash.slice(6);
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
        plyRef.current = h.length;
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
  }, [refreshDerived, connectRoom]);

  // gated auto-join: only connect to a #live= game once the user is signed in
  useEffect(() => {
    const room = pendingJoinRef.current;
    if (!room || onlineRef.current) return;
    if (!profile) return; // wait until signed in
    pendingJoinRef.current = "";
    const nick = profile.nickname;
    myNickRef.current = nick;
    gameIdRef.current = room;
    const saved = loadSession();
    if (saved && saved.room === room) {
      connectRoom(room, saved.isHost, nick, {
        moves: saved.moves,
        score: saved.score,
        tcId: saved.tcId,
      });
    } else {
      joinGame(room, { uid: profile.uid, nick, rating: profile.rating }).catch(
        () => {},
      );
      connectRoom(room, false, nick);
    }
  }, [profile, connectRoom]);

  // opened an invite while signed out (and auth has settled) → send them to the login page
  useEffect(() => {
    if (authReady && !profile && pendingJoinRef.current) {
      const back = window.location.pathname + `#live=${pendingJoinRef.current}`;
      window.location.href = `/login?next=${encodeURIComponent(back)}`;
    }
  }, [authReady, profile]);

  // allow opening a different invite link in the same tab (hash changes without a reload)
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#live=")) return;
      const room = hash.slice(6);
      if (!room || room === roomRef.current) return;
      // best-effort notify the room we're currently in, then join the new one as a guest
      if (clientRef.current && onlineRef.current) {
        try {
          publish({ t: "left", id: myId, explicit: true });
        } catch {
          /* noop */
        }
      }
      clearSession();
      if (!profile) {
        const back = window.location.pathname + `#live=${room}`;
        window.location.href = `/login?next=${encodeURIComponent(back)}`;
        return;
      }
      const nick = profile.nickname;
      gameIdRef.current = room;
      joinGame(room, { uid: profile.uid, nick, rating: profile.rating }).catch(
        () => {},
      );
      setTimeout(() => connectRoom(room, false, nick), 300);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [publish, myId, connectRoom, profile]);

  useEffect(
    () => () => {
      clientRef.current?.end(true);
    },
    [],
  );

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

  useEffect(() => {
    if (
      !gameOver ||
      !result ||
      !online ||
      online.role === "spec" ||
      !gameIdRef.current ||
      !ratedRef.current
    )
      return;
    applyRating(
      gameIdRef.current,
      online.role,
      result as unknown as FbResult,
    ).catch(() => {});
  }, [gameOver, result, online]);

  const newGame = useCallback(() => {
    if (onlineRef.current) {
      if (myRoleRef.current === "spec") return;
      if (onlineRef.current.status === "connected") {
        publish({ t: "rematch" });
        setRematch("sent");
        return;
      }
      return;
    }
    if (window.location.hash)
      window.history.replaceState(null, "", window.location.pathname);
    setLocked(false);
    resetTo([]);
  }, [resetTo, publish]);

  const acceptRematch = useCallback(() => {
    publish({ t: "rematch-accept" });
    resetTo([]);
    setRematch("none");
  }, [publish, resetTo]);
  const declineRematch = useCallback(() => {
    publish({ t: "rematch-decline" });
    setRematch("none");
  }, [publish]);

  const resign = useCallback(() => {
    publish({ t: "resign" });
    showToast(tr(langRef.current, "flagRaised"));
  }, [publish, showToast]);
  const acceptResign = useCallback(() => {
    const w = (myRoleRef.current === "b" ? "b" : "w") as Color;
    setScore((s) => ({ ...s, [w]: s[w] + 1 }));
    resetTo([]);
    publish({ t: "resign-accept", winner: w });
    setResignIncoming(false);
    showToast(tr(langRef.current, "winByResign"));
  }, [publish, resetTo, showToast]);
  const declineResign = useCallback(() => {
    publish({ t: "resign-decline" });
    setResignIncoming(false);
  }, [publish]);
  const applyTakeback = useCallback(() => {
    const moves = historyRef.current;
    if (moves.length === 0) return;
    const saved = { ...clockRef.current };
    resetTo(moves.slice(0, moves.length - 1));
    clockRef.current = saved;
    setClock(saved);
  }, [resetTo]);
  const requestTakeback = useCallback(() => {
    const on = onlineRef.current;
    if (
      !on ||
      on.status !== "connected" ||
      myRoleRef.current === "spec" ||
      historyRef.current.length === 0
    )
      return;
    if (takebackUsedRef.current >= 3) {
      showToast(tr(langRef.current, "takebackLimit"));
      return;
    }
    setTakebackPending(true);
    publish({ t: "takeback" });
    showToast(tr(langRef.current, "takebackSent"));
  }, [publish, showToast]);
  const allowTakeback = useCallback(() => {
    setTakebackIncoming(false);
    publish({ t: "takeback-accept" });
    applyTakeback();
  }, [publish, applyTakeback]);
  const declineTakeback = useCallback(() => {
    setTakebackIncoming(false);
    publish({ t: "takeback-decline" });
  }, [publish]);

  const flip = () => setOrientation((o) => (o === "w" ? "b" : "w"));

  const undo = useCallback(() => {
    if (online) {
      requestTakeback();
      return;
    }
    if (history.length === 0) return;
    const keep = history.slice(0, history.length - 1);
    while (
      mode === "ai" &&
      keep.length > 0 &&
      (keep.length % 2 === 0 ? "w" : "b") === aiSide
    )
      keep.pop();
    resetTo(keep);
  }, [history, mode, aiSide, resetTo, online, requestTakeback]);

  const chooseMode = (m: "human" | "ai") => {
    leaveOnline();
    setMode(m);
    setLocked(false);
    setScore({ w: 0, b: 0 });
    resetTo([]);
  };
  const chooseSide = (you: Color) => {
    setAiSide(you === "w" ? "b" : "w");
    setOrientation(you);
    setLocked(false);
    setScore({ w: 0, b: 0 });
    resetTo([]);
  };
  const toggleSound = () =>
    setSoundOn((s) => {
      soundRef.current = !s;
      if (!s) tick(true);
      return !s;
    });
  const unlock = () => setLocked(false);

  const sendChat = useCallback(
    (m: QuickSend) => {
      const nick = myNickRef.current || tr(langRef.current, "you");
      if (m.quick)
        setChat((c) => [
          ...c,
          { from: "me", nick, quick: true, key: m.key, color: m.color },
        ]);
      else {
        const clean = (m.text ?? "").trim().slice(0, 200);
        if (!clean) return;
        setChat((c) => [...c, { from: "me", nick, quick: false, text: clean }]);
        m = { ...m, text: clean };
      }
      publish({
        t: "chat",
        nick,
        quick: m.quick,
        key: m.key,
        text: m.text,
        color: m.color,
      });
      playChat(soundRef.current);
    },
    [publish],
  );

  const onCursorMove = useCallback(
    (x: number, y: number) => {
      const on = onlineRef.current;
      if (!on || on.status !== "connected" || on.role === "spec") return;
      const now = performance.now();
      if (now - cursorSentRef.current < 70) return;
      cursorSentRef.current = now;
      publish({ t: "cursor", x, y, o: orientationRef.current });
    },
    [publish],
  );

  const startEditNick = useCallback(() => {
    const on = onlineRef.current;
    if (!on || on.role === "spec") return;
    setNickDraft(
      myNickRef.current ||
        (on.role === "w" ? on.whiteNick : (on.blackNick ?? "")),
    );
    setEditingNick(true);
  }, []);
  const cancelNick = useCallback(() => setEditingNick(false), []);
  const commitNick = useCallback(() => {
    setEditingNick(false);
    const n = nickDraft.trim().slice(0, 18);
    if (!n || myRoleRef.current === "spec" || n === myNickRef.current) return;
    myNickRef.current = n;
    try {
      window.localStorage.setItem("chess-nick", n);
    } catch {
      /* noop */
    }
    if (profile) setNickname(profile.uid, n).catch(() => {}); // ← persist to the account
    try {
      window.localStorage.setItem("chess-nick", n);
    } catch {
      /* noop */
    }
    const r = rosterRef.current;
    if (r.white.id === myId) r.white = { ...r.white, nick: n };
    else if (r.black && r.black.id === myId) r.black = { ...r.black, nick: n };
    setOnline((o) =>
      o
        ? { ...o, whiteNick: r.white.nick, blackNick: r.black?.nick ?? null }
        : o,
    );
    publish({ t: "nick", id: myId, nick: n });
  }, [nickDraft, publish, myId, profile]);

  const legalFor = useCallback((r: number, c: number): Move[] => {
    const g = engineRef.current;
    return g
      .legalMoves(g.turn)
      .filter((m) => m.from[0] === r && m.from[1] === c);
  }, []);

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
    for (let i = 0; i < FULL[k] - (remain.b[k] ?? 0); i++)
      capturedByWhite.push(k);
    for (let i = 0; i < FULL[k] - (remain.w[k] ?? 0); i++)
      capturedByBlack.push(k);
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

  const inProgress = history.length > 0 && !gameOver;
  const isPlayer = !!online && online.role !== "spec";
  const interactive =
    !gameOver &&
    !locked &&
    (online
      ? isPlayer && online.status === "connected" && turn === online.role
      : !(mode === "ai" && turn === aiSide));
  const inCheck = checkSquare !== null;
  const timed = tcId !== "none";

  const bottomColor: Color = orientation;
  const topColor: Color = orientation === "w" ? "b" : "w";
  const labelFor = (c: Color): string => {
    if (online) return c === "w" ? online.whiteNick : (online.blackNick ?? "…");
    if (mode === "ai")
      return c === aiSide ? tr(lang, "computer") : tr(lang, "you");
    return c === "w" ? tr(lang, "white") : tr(lang, "black");
  };
  const canShowTurn = !gameOver && !(online && online.status !== "connected");
  const Tag = ({ c }: { c: Color }) => {
    const active = canShowTurn && turn === c;
    const low = timed && clock[c] < 10000;
    const isMe = !!online && online.role === c;
    return (
      <div className={"player" + (active ? " active" : "")}>
        <span className={"turn-dot " + c} />
        {online && online.role === c && profile && (
          <span className="prating">{profile.rating}</span>
        )}
        {isMe && editingNick ? (
          <input
            className="pname-edit"
            value={nickDraft}
            maxLength={18}
            autoFocus
            onChange={(e) => setNickDraft(e.target.value)}
            onBlur={commitNick}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitNick();
              if (e.key === "Escape") cancelNick();
            }}
          />
        ) : (
          <span
            className={"pname" + (isMe ? " editable" : "")}
            onDoubleClick={isMe ? startEditNick : undefined}
            title={isMe ? tr(lang, "editNickHint") : undefined}
          >
            {labelFor(c)}
          </span>
        )}
        {online && online.status === "connected" && <PingBars rtt={ping[c]} />}
        <span className="pscore">{score[c]}</span>
        {timed ? (
          <span
            className={"pclock" + (low ? " low" : "") + (active ? " run" : "")}
          >
            {fmtClock(clock[c])}
          </span>
        ) : (
          active && <span className="tomove">● {tr(lang, "toMove")}</span>
        )}
      </div>
    );
  };

  // result modal
  let modalTitle = "",
    modalTone = "draw";
  if (result) {
    if (result.kind === "draw" || result.kind === "stalemate") {
      modalTitle = tr(lang, "draw");
      modalTone = "draw";
    } else {
      const w = result.winner;
      const iWin: boolean | null = online
        ? online.role !== "spec"
          ? w === online.role
          : null
        : mode === "ai"
          ? w !== aiSide
          : null;
      if (iWin === true) {
        modalTitle = tr(lang, "youWin");
        modalTone = "win";
      } else if (iWin === false) {
        modalTitle = tr(lang, "youLose");
        modalTone = "lose";
      } else {
        modalTitle = w === "w" ? tr(lang, "whiteWins") : tr(lang, "blackWins");
        modalTone = "win";
      }
    }
  }
  let modalSub = "";
  if (result) {
    if (result.kind === "checkmate") modalSub = tr(lang, "checkmate");
    else if (result.kind === "timeout") modalSub = tr(lang, "timesUp");
    else if (result.kind === "abandon")
      modalSub = leaverNick
        ? `${leaverNick} ${tr(lang, "leftSuffix")}`
        : tr(lang, "opponentLeft");
    else if (result.kind === "stalemate") modalSub = tr(lang, "stalemateSub");
    else
      modalSub =
        result.reason === "fifty"
          ? tr(lang, "fifty")
          : result.reason === "insufficient"
            ? tr(lang, "insufficient")
            : tr(lang, "threefold");
  }

  const resignerNick = online
    ? online.role === "w"
      ? (online.blackNick ?? tr(lang, "opponent"))
      : online.whiteNick
    : tr(lang, "opponent");

  return (
    <div className={"app" + (online ? " with-chat" : "")}>
      <Navbar
        profile={profile}
        lang={lang}
        onSignIn={doSignIn}
        onSignOut={doSignOut}
        onLang={setLang}
      />

      <Confetti fire={confetti} />

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
            onCursor={onCursorMove}
            remoteCursor={remoteCursor}
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
        canPlayOnline={!!profile}
        onRematchAccept={acceptRematch}
        onRematchDecline={declineRematch}
        onResign={resign}
        capturedByWhite={capturedByWhite}
        capturedByBlack={capturedByBlack}
        advantage={advantage}
        history={history}
        soundOn={soundOn}
        onToggleSound={toggleSound}
        onNew={newGame}
        onFlip={flip}
        onUndo={undo}
        takebackPending={takebackPending}
      />

      {/* nickname modal */}
      {nickPrompt && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-title" style={{ fontSize: 22 }}>
              {tr(lang, "enterNick")}
            </div>
            <input
              className="nick-input"
              value={nickInput}
              maxLength={18}
              autoFocus
              onChange={(e) => setNickInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmNick();
              }}
            />
            <div className="modal-btns">
              <button className="primary" onClick={confirmNick}>
                {nickPrompt.isHost ? tr(lang, "startBtn") : tr(lang, "joinBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* resignation offer (shown to the opponent) */}
      {resignIncoming && (
        <div className="modal-overlay">
          <div className="modal draw">
            <div className="modal-flag">🏳️</div>
            <div className="modal-title" style={{ fontSize: 22 }}>
              {resignerNick} {tr(lang, "raisedFlag")}
            </div>
            <div className="modal-btns">
              <button className="primary" onClick={acceptResign}>
                {tr(lang, "acceptWin")}
              </button>
              <button onClick={declineResign}>
                {tr(lang, "continuePlaying")}
              </button>
            </div>
          </div>
        </div>
      )}

      {takebackIncoming && (
        <div className="modal-overlay">
          <div className="modal draw">
            <div className="modal-flag">↶</div>
            <div className="modal-title" style={{ fontSize: 22 }}>
              {resignerNick} {tr(lang, "takebackAsks")}
            </div>
            <div className="modal-btns">
              <button className="primary" onClick={allowTakeback}>
                {tr(lang, "allow")}
              </button>
              <button onClick={declineTakeback}>{tr(lang, "decline")}</button>
            </div>
          </div>
        </div>
      )}

      {/* player left → back home */}
      {leftInfo && (
        <div className="modal-overlay">
          <div className="modal lose">
            <div className="modal-title" style={{ fontSize: 22 }}>
              {leftInfo.nick} {tr(lang, "leftSuffix")}
            </div>
            <div className="modal-btns">
              <button className="primary" onClick={leaveOnline}>
                {tr(lang, "okHome")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* game over */}
      {gameOver && showResult && result && (
        <div
          className="modal-overlay"
          onClick={
            result.kind === "abandon" ? undefined : () => setShowResult(false)
          }
        >
          <div
            className={"modal " + modalTone}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title">{modalTitle}</div>
            <div className="modal-sub">{modalSub}</div>
            {result.kind === "abandon" ? (
              <div className="modal-btns">
                <button className="primary" onClick={leaveOnline}>
                  {tr(lang, "okHome")}
                </button>
              </div>
            ) : (
              <>
                <div className="modal-score">
                  <span className="turn-dot w" /> {score.w}
                  <span className="dash">–</span>
                  {score.b} <span className="turn-dot b" />
                </div>
                <div className="modal-btns">
                  <button
                    className="primary"
                    onClick={() => {
                      setShowResult(false);
                      newGame();
                    }}
                    disabled={isPlayer === false && !!online}
                  >
                    {online ? tr(lang, "rematch") : tr(lang, "newGame")}
                  </button>
                  <button onClick={() => setShowResult(false)}>
                    {tr(lang, "close")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {peerAway && !gameOver && online?.status === "connected" && (
        <div className="reconnect-note">⟳ {tr(lang, "oppReconnecting")}</div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
