import {
  collection,
  doc,
  addDoc,
  onSnapshot,
  getDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { auth, db } from "./firebase";

export type Color = "w" | "b";
export type StoredMove = {
  from: [number, number];
  to: [number, number];
  promotion?: string;
  san?: string;
};
export type PlayerRef = { uid: string; nick: string; rating: number } | null;
export type GameResult =
  | { kind: "checkmate" | "timeout" | "resign" | "abandon"; winner: Color }
  | { kind: "stalemate" }
  | { kind: "draw"; reason: string };

export type GameDoc = {
  status: "waiting" | "active" | "finished";
  hostUid: string;
  hostColor: Color;
  white: PlayerRef;
  black: PlayerRef;
  tcId: string;
  rated: boolean;
  moves: StoredMove[];
  ply: number;
  clocks: { w: number; b: number };
  turn: Color;
  result: GameResult | null;
  ratingAppliedW?: boolean;
  ratingAppliedB?: boolean;
  spectatorCount?: number;
};

export async function createGame(
  host: { uid: string; nick: string; rating: number },
  tcId: string,
  rated = true,
  hostColor: Color = "w",
) {
  const hp = { uid: host.uid, nick: host.nick, rating: host.rating };
  const ref = await addDoc(collection(db, "games"), {
    status: "waiting",
    hostUid: host.uid,
    hostColor,
    white: hostColor === "w" ? hp : null,
    black: hostColor === "b" ? hp : null,
    tcId,
    rated,
    moves: [],
    ply: 0,
    clocks: { w: 0, b: 0 },
    turn: "w",
    result: null,
    ratingAppliedW: false,
    ratingAppliedB: false,
    spectatorCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } as Omit<GameDoc, never>);
  return ref.id;
}

/** Take the black seat if open; else become a spectator. Transaction => exactly one black. */
export async function joinGame(
  gameId: string,
  me: { uid: string; nick: string; rating: number },
): Promise<Color | "spectator"> {
  const ref = doc(db, "games", gameId);
  return runTransaction(db, async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists()) throw new Error("game-not-found");
    const g = s.data() as GameDoc;

    if (g.status === "finished") return "spectator";
    if (g.white?.uid === me.uid) return "w";
    if (g.black?.uid === me.uid) return "b";

    const meRef = { uid: me.uid, nick: me.nick, rating: me.rating };
    if (!g.white) {
      tx.update(ref, {
        white: meRef,
        status: "active",
        updatedAt: serverTimestamp(),
      });
      return "w";
    }
    if (!g.black) {
      tx.update(ref, {
        black: meRef,
        status: "active",
        updatedAt: serverTimestamp(),
      });
      return "b";
    }

    tx.update(ref, { spectatorCount: increment(1) });
    return "spectator";
  });
}

export const leaveSpectator = (gameId: string) =>
  updateDoc(doc(db, "games", gameId), { spectatorCount: increment(-1) }).catch(
    () => {},
  );

/** Snapshot sync — players + spectators subscribe and render from this. */
export function subscribeGame(gameId: string, cb: (g: GameDoc | null) => void) {
  return onSnapshot(doc(db, "games", gameId), (s) =>
    cb(s.exists() ? (s.data() as GameDoc) : null),
  );
}

/** One-shot fetch of a game doc (used by the review page / finished-link checks). */
export async function getGame(gameId: string): Promise<GameDoc | null> {
  const s = await getDoc(doc(db, "games", gameId));
  return s.exists() ? (s.data() as GameDoc) : null;
}

export const setResult = (gameId: string, result: GameResult) =>
  updateDoc(doc(db, "games", gameId), {
    result,
    status: "finished",
    updatedAt: serverTimestamp(),
  });

export const setPlayerNick = (gameId: string, color: Color, nick: string) =>
  updateDoc(doc(db, "games", gameId), {
    [`${color}.nick`]: nick,
    updatedAt: serverTimestamp(),
  });

function scoreFor(color: Color, r: GameResult): number | null {
  if (r.kind === "stalemate" || r.kind === "draw") return 0.5;
  if ("winner" in r) return r.winner === color ? 1 : 0;
  return null;
}

/** Each player calls this once at game end with their own color. Updates only their own user doc. */
export async function applyRating(
  gameId: string,
  color: Color,
  result: GameResult,
) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const gRef = doc(db, "games", gameId);
  const uRef = doc(db, "users", uid);
  await runTransaction(db, async (tx) => {
    const gs = await tx.get(gRef);
    const g = gs.data() as GameDoc | undefined;
    if (!g || !g.rated || !g.white || !g.black) return;
    const appliedKey = color === "w" ? "ratingAppliedW" : "ratingAppliedB";
    if ((g as Record<string, unknown>)[appliedKey]) return; // already counted
    const mine = color === "w" ? g.white : g.black;
    if (!mine || mine.uid !== uid) return; // I'm not this color
    const score = scoreFor(color, result);
    if (score == null) return;
    const oppRating = (color === "w" ? g.black : g.white)!.rating;

    const us = await tx.get(uRef);
    const u = us.data() as { rating: number; games: number } | undefined;
    const rating = u?.rating ?? 400,
      games = u?.games ?? 0;
    const k = games < 30 ? 40 : rating < 2400 ? 20 : 10;
    const expected = 1 / (1 + Math.pow(10, (oppRating - rating) / 400));
    let delta = Math.round(k * (score - expected));
    delta = Math.max(-64, Math.min(64, delta)); // stay within rules bound

    tx.set(
      uRef,
      {
        rating: rating + delta,
        games: increment(1),
        wins: increment(score === 1 ? 1 : 0),
        losses: increment(score === 0 ? 1 : 0),
        draws: increment(score === 0.5 ? 1 : 0),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    tx.update(gRef, { [appliedKey]: true });
  });
}
