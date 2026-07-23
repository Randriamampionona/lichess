// Chess engine — validated with perft:
//   start position perft(4) = 197281, Kiwipete perft(3) = 97862
// Board is 8x8, row 0 = rank 8 (top). Uppercase = white, lowercase = black.

export type Color = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type Cell = string | null;
export type BoardT = Cell[][];

export interface Move {
  from: [number, number];
  to: [number, number];
  promotion?: PieceType;
  captured?: string;
  enpassant?: boolean;
  double?: boolean;
  castle?: "K" | "Q" | "k" | "q";
}

type MoveExtra = Omit<Partial<Move>, "from" | "to">;

export interface Castling {
  K: boolean;
  Q: boolean;
  k: boolean;
  q: boolean;
}

export const GLYPH: Record<PieceType, string> = {
  p: "\u265F\uFE0E",
  n: "\u265E\uFE0E",
  b: "\u265D\uFE0E",
  r: "\u265C\uFE0E",
  q: "\u265B\uFE0E",
  k: "\u265A\uFE0E",
};

export const FILES = "abcdefgh";

const START: BoardT = [
  ["r", "n", "b", "q", "k", "b", "n", "r"],
  ["p", "p", "p", "p", "p", "p", "p", "p"],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  ["P", "P", "P", "P", "P", "P", "P", "P"],
  ["R", "N", "B", "Q", "K", "B", "N", "R"],
];

export const isW = (p: Cell): boolean => !!p && p === p.toUpperCase();
export const colorOf = (p: string): Color => (isW(p) ? "w" : "b");
const inside = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

const N_DELTA = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const K_DELTA = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const B_DIR = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const R_DIR = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const PROMO: PieceType[] = ["q", "r", "b", "n"];

export class Chess {
  board: BoardT;
  turn: Color;
  castling: Castling;
  ep: [number, number] | null;
  half: number;
  full: number;

  constructor() {
    this.board = START.map((r) => r.slice());
    this.turn = "w";
    this.castling = { K: true, Q: true, k: true, q: true };
    this.ep = null;
    this.half = 0;
    this.full = 1;
  }

  clone(): Chess {
    const c = Object.create(Chess.prototype) as Chess;
    c.board = this.board.map((r) => r.slice());
    c.turn = this.turn;
    c.castling = { ...this.castling };
    c.ep = this.ep ? [this.ep[0], this.ep[1]] : null;
    c.half = this.half;
    c.full = this.full;
    return c;
  }

  findKing(color: Color): [number, number] | null {
    const k = color === "w" ? "K" : "k";
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) if (this.board[r][c] === k) return [r, c];
    return null;
  }

  attacked(r: number, c: number, by: Color): boolean {
    const B = this.board;
    if (by === "w") {
      if (inside(r + 1, c - 1) && B[r + 1][c - 1] === "P") return true;
      if (inside(r + 1, c + 1) && B[r + 1][c + 1] === "P") return true;
    } else {
      if (inside(r - 1, c - 1) && B[r - 1][c - 1] === "p") return true;
      if (inside(r - 1, c + 1) && B[r - 1][c + 1] === "p") return true;
    }
    for (const [dr, dc] of N_DELTA) {
      const nr = r + dr, nc = c + dc;
      if (inside(nr, nc)) {
        const p = B[nr][nc];
        if (p && colorOf(p) === by && p.toLowerCase() === "n") return true;
      }
    }
    for (const [dr, dc] of K_DELTA) {
      const nr = r + dr, nc = c + dc;
      if (inside(nr, nc)) {
        const p = B[nr][nc];
        if (p && colorOf(p) === by && p.toLowerCase() === "k") return true;
      }
    }
    for (const [dr, dc] of B_DIR) {
      let nr = r + dr, nc = c + dc;
      while (inside(nr, nc)) {
        const p = B[nr][nc];
        if (p) {
          if (colorOf(p) === by && (p.toLowerCase() === "b" || p.toLowerCase() === "q")) return true;
          break;
        }
        nr += dr; nc += dc;
      }
    }
    for (const [dr, dc] of R_DIR) {
      let nr = r + dr, nc = c + dc;
      while (inside(nr, nc)) {
        const p = B[nr][nc];
        if (p) {
          if (colorOf(p) === by && (p.toLowerCase() === "r" || p.toLowerCase() === "q")) return true;
          break;
        }
        nr += dr; nc += dc;
      }
    }
    return false;
  }

  inCheck(color: Color): boolean {
    const k = this.findKing(color);
    return k ? this.attacked(k[0], k[1], color === "w" ? "b" : "w") : false;
  }

  pseudoMoves(color: Color): Move[] {
    const B = this.board;
    const moves: Move[] = [];
    const enemy: Color = color === "w" ? "b" : "w";
    const add = (fr: number, fc: number, tr: number, tc: number, ex: MoveExtra = {}) =>
      moves.push({ from: [fr, fc], to: [tr, tc], ...ex });

    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const p = B[r][c];
        if (!p || colorOf(p) !== color) continue;
        const t = p.toLowerCase();

        if (t === "p") {
          const dir = color === "w" ? -1 : 1;
          const startRow = color === "w" ? 6 : 1;
          const promoRow = color === "w" ? 0 : 7;
          if (inside(r + dir, c) && !B[r + dir][c]) {
            if (r + dir === promoRow) for (const pr of PROMO) add(r, c, r + dir, c, { promotion: pr });
            else add(r, c, r + dir, c);
            if (r === startRow && !B[r + 2 * dir][c]) add(r, c, r + 2 * dir, c, { double: true });
          }
          for (const dc of [-1, 1]) {
            const nr = r + dir, nc = c + dc;
            if (!inside(nr, nc)) continue;
            const tp = B[nr][nc];
            if (tp && colorOf(tp) === enemy) {
              if (nr === promoRow) for (const pr of PROMO) add(r, c, nr, nc, { promotion: pr, captured: tp });
              else add(r, c, nr, nc, { captured: tp });
            } else if (this.ep && this.ep[0] === nr && this.ep[1] === nc) {
              add(r, c, nr, nc, { enpassant: true });
            }
          }
        } else if (t === "n") {
          for (const [dr, dc] of N_DELTA) {
            const nr = r + dr, nc = c + dc;
            if (inside(nr, nc)) {
              const tp = B[nr][nc];
              if (!tp || colorOf(tp) === enemy) add(r, c, nr, nc, tp ? { captured: tp } : {});
            }
          }
        } else if (t === "k") {
          for (const [dr, dc] of K_DELTA) {
            const nr = r + dr, nc = c + dc;
            if (inside(nr, nc)) {
              const tp = B[nr][nc];
              if (!tp || colorOf(tp) === enemy) add(r, c, nr, nc, tp ? { captured: tp } : {});
            }
          }
          const g = this.castling;
          if (color === "w" && r === 7 && c === 4) {
            if (g.K && !B[7][5] && !B[7][6] && B[7][7] === "R" &&
              !this.attacked(7, 4, "b") && !this.attacked(7, 5, "b") && !this.attacked(7, 6, "b"))
              add(7, 4, 7, 6, { castle: "K" });
            if (g.Q && !B[7][3] && !B[7][2] && !B[7][1] && B[7][0] === "R" &&
              !this.attacked(7, 4, "b") && !this.attacked(7, 3, "b") && !this.attacked(7, 2, "b"))
              add(7, 4, 7, 2, { castle: "Q" });
          }
          if (color === "b" && r === 0 && c === 4) {
            if (g.k && !B[0][5] && !B[0][6] && B[0][7] === "r" &&
              !this.attacked(0, 4, "w") && !this.attacked(0, 5, "w") && !this.attacked(0, 6, "w"))
              add(0, 4, 0, 6, { castle: "k" });
            if (g.q && !B[0][3] && !B[0][2] && !B[0][1] && B[0][0] === "r" &&
              !this.attacked(0, 4, "w") && !this.attacked(0, 3, "w") && !this.attacked(0, 2, "w"))
              add(0, 4, 0, 2, { castle: "q" });
          }
        } else {
          const dirs = t === "b" ? B_DIR : t === "r" ? R_DIR : [...B_DIR, ...R_DIR];
          for (const [dr, dc] of dirs) {
            let nr = r + dr, nc = c + dc;
            while (inside(nr, nc)) {
              const tp = B[nr][nc];
              if (!tp) add(r, c, nr, nc);
              else {
                if (colorOf(tp) === enemy) add(r, c, nr, nc, { captured: tp });
                break;
              }
              nr += dr; nc += dc;
            }
          }
        }
      }
    return moves;
  }

  legalMoves(color: Color = this.turn): Move[] {
    const res: Move[] = [];
    for (const m of this.pseudoMoves(color)) {
      const cp = this.clone();
      cp.applyMove(m);
      if (!cp.inCheck(color)) res.push(m);
    }
    return res;
  }

  applyMove(m: Move): void {
    const B = this.board;
    const [fr, fc] = m.from;
    const [tr, tc] = m.to;
    const p = B[fr][fc] as string;
    const color = colorOf(p);
    this.ep = null;
    B[tr][tc] = p;
    B[fr][fc] = null;
    if (m.enpassant) B[fr][tc] = null;
    if (m.promotion) B[tr][tc] = color === "w" ? m.promotion.toUpperCase() : m.promotion;
    if (m.castle === "K") { B[7][5] = B[7][7]; B[7][7] = null; }
    if (m.castle === "Q") { B[7][3] = B[7][0]; B[7][0] = null; }
    if (m.castle === "k") { B[0][5] = B[0][7]; B[0][7] = null; }
    if (m.castle === "q") { B[0][3] = B[0][0]; B[0][0] = null; }
    if (m.double) this.ep = [(fr + tr) / 2, fc];
    if (p === "K") { this.castling.K = false; this.castling.Q = false; }
    if (p === "k") { this.castling.k = false; this.castling.q = false; }
    if (fr === 7 && fc === 0) this.castling.Q = false;
    if (fr === 7 && fc === 7) this.castling.K = false;
    if (fr === 0 && fc === 0) this.castling.q = false;
    if (fr === 0 && fc === 7) this.castling.k = false;
    if (tr === 7 && tc === 0) this.castling.Q = false;
    if (tr === 7 && tc === 7) this.castling.K = false;
    if (tr === 0 && tc === 0) this.castling.q = false;
    if (tr === 0 && tc === 7) this.castling.k = false;
    if (p.toLowerCase() === "p" || m.captured || m.enpassant) this.half = 0;
    else this.half++;
    if (color === "b") this.full++;
    this.turn = color === "w" ? "b" : "w";
  }

  key(): string {
    return (
      this.board.map((r) => r.map((x) => x || ".").join("")).join("/") +
      " " + this.turn + " " +
      (this.castling.K ? "K" : "") + (this.castling.Q ? "Q" : "") +
      (this.castling.k ? "k" : "") + (this.castling.q ? "q" : "") +
      " " + (this.ep ? this.ep.join(",") : "-")
    );
  }

  insufficientMaterial(): boolean {
    const pieces: string[] = [];
    for (const row of this.board)
      for (const p of row) if (p && p.toLowerCase() !== "k") pieces.push(p.toLowerCase());
    if (pieces.length === 0) return true;
    if (pieces.length === 1 && (pieces[0] === "b" || pieces[0] === "n")) return true;
    if (pieces.length === 2 && pieces.every((x) => x === "b")) return true;
    return false;
  }
}

// ---- SAN (Standard Algebraic Notation) ----
const sqName = (r: number, c: number) => FILES[c] + (8 - r);

export function toSAN(before: Chess, m: Move, after: Chess): string {
  let s: string;
  const p = before.board[m.from[0]][m.from[1]] as string;
  const t = p.toLowerCase();

  if (m.castle === "K" || m.castle === "k") s = "O-O";
  else if (m.castle === "Q" || m.castle === "q") s = "O-O-O";
  else if (t === "p") {
    const capture = m.captured || m.enpassant;
    s = (capture ? FILES[m.from[1]] + "x" : "") + sqName(m.to[0], m.to[1]);
    if (m.promotion) s += "=" + m.promotion.toUpperCase();
  } else {
    const L = t.toUpperCase();
    let ambiguous = false, sameFile = false, sameRank = false;
    for (const o of before.legalMoves(before.turn)) {
      if (o.to[0] === m.to[0] && o.to[1] === m.to[1] && !(o.from[0] === m.from[0] && o.from[1] === m.from[1])) {
        const op = before.board[o.from[0]][o.from[1]];
        if (op && op.toLowerCase() === t) {
          ambiguous = true;
          if (o.from[1] === m.from[1]) sameFile = true;
          if (o.from[0] === m.from[0]) sameRank = true;
        }
      }
    }
    let dis = "";
    if (ambiguous) {
      if (!sameFile) dis = FILES[m.from[1]];
      else if (!sameRank) dis = String(8 - m.from[0]);
      else dis = sqName(m.from[0], m.from[1]);
    }
    s = L + dis + (m.captured ? "x" : "") + sqName(m.to[0], m.to[1]);
  }

  const opp = after.turn;
  if (after.inCheck(opp)) s += after.legalMoves(opp).length === 0 ? "#" : "+";
  return s;
}

// ---- Shareable game encoding ----
// Each move -> 5 chars: fromFile fromRank toFile toRank promo('-' if none)
export function encodeMoves(moves: Move[]): string {
  return moves
    .map((m) => FILES[m.from[1]] + (8 - m.from[0]) + FILES[m.to[1]] + (8 - m.to[0]) + (m.promotion ?? "-"))
    .join("");
}

export function decodeGame(code: string): { game: Chess; history: { san: string; move: Move }[] } {
  const game = new Chess();
  const history: { san: string; move: Move }[] = [];
  for (let i = 0; i + 5 <= code.length; i += 5) {
    const seg = code.slice(i, i + 5);
    const fromC = FILES.indexOf(seg[0]);
    const fromR = 8 - parseInt(seg[1], 10);
    const toC = FILES.indexOf(seg[2]);
    const toR = 8 - parseInt(seg[3], 10);
    const promo = seg[4] === "-" ? undefined : (seg[4] as PieceType);
    if (fromC < 0 || toC < 0 || Number.isNaN(fromR) || Number.isNaN(toR)) break;
    const legal = game.legalMoves(game.turn);
    const m = legal.find(
      (x) =>
        x.from[0] === fromR && x.from[1] === fromC &&
        x.to[0] === toR && x.to[1] === toC &&
        (promo ? x.promotion === promo : true)
    );
    if (!m) break;
    const before = game.clone();
    const after = game.clone();
    after.applyMove(m);
    history.push({ san: toSAN(before, m, after), move: m });
    game.applyMove(m);
  }
  return { game, history };
}
