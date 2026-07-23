import { Chess, Move, PieceType, isW } from "@/lib/engine";

const VAL: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

const PST: Record<PieceType, number[][]> = {
  p: [
    [0, 0, 0, 0, 0, 0, 0, 0], [50, 50, 50, 50, 50, 50, 50, 50], [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5], [0, 0, 0, 20, 20, 0, 0, 0], [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5], [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  n: [
    [-50, -40, -30, -30, -30, -30, -40, -50], [-40, -20, 0, 0, 0, 0, -20, -40], [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30], [-30, 0, 15, 20, 20, 15, 0, -30], [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40], [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  b: [
    [-20, -10, -10, -10, -10, -10, -10, -20], [-10, 0, 0, 0, 0, 0, 0, -10], [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10], [-10, 0, 10, 10, 10, 10, 0, -10], [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10], [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  r: [
    [0, 0, 0, 0, 0, 0, 0, 0], [5, 10, 10, 10, 10, 10, 10, 5], [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5], [-5, 0, 0, 0, 0, 0, 0, -5], [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5], [0, 0, 0, 5, 5, 0, 0, 0],
  ],
  q: [
    [-20, -10, -10, -5, -5, -10, -10, -20], [-10, 0, 0, 0, 0, 0, 0, -10], [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5], [0, 0, 5, 5, 5, 5, 0, -5], [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10], [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
  k: [
    [-30, -40, -40, -50, -50, -40, -40, -30], [-30, -40, -40, -50, -50, -40, -40, -30], [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30], [-20, -30, -30, -40, -40, -30, -30, -20], [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20], [20, 30, 10, 0, 0, 10, 30, 20],
  ],
};

const MATE = 1e6;

function evaluate(g: Chess): number {
  let s = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = g.board[r][c];
      if (!p) continue;
      const t = p.toLowerCase() as PieceType;
      if (isW(p)) s += VAL[t] + PST[t][r][c];
      else s -= VAL[t] + PST[t][7 - r][c];
    }
  return s;
}

function order(g: Chess, moves: Move[]): Move[] {
  return moves
    .map((m): [number, Move] => {
      let sc = 0;
      if (m.captured) sc = 10 * VAL[m.captured.toLowerCase() as PieceType] - VAL[(g.board[m.from[0]][m.from[1]] as string).toLowerCase() as PieceType];
      if (m.promotion) sc += 800;
      return [sc, m];
    })
    .sort((a, b) => b[0] - a[0])
    .map((x) => x[1]);
}

function negamax(g: Chess, depth: number, alpha: number, beta: number, ply: number): number {
  const moves = g.legalMoves(g.turn);
  if (moves.length === 0) return g.inCheck(g.turn) ? -MATE + ply : 0;
  if (depth === 0) {
    const e = evaluate(g);
    return g.turn === "w" ? e : -e;
  }
  let best = -Infinity;
  for (const m of order(g, moves)) {
    const cp = g.clone();
    cp.applyMove(m);
    const sc = -negamax(cp, depth - 1, -beta, -alpha, ply + 1);
    if (sc > best) best = sc;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function bestMove(g: Chess, depth: number): Move | null {
  const moves = order(g, g.legalMoves(g.turn));
  if (moves.length === 0) return null;
  let best = -Infinity;
  let pick = moves[0];
  let ties: Move[] = [];
  for (const m of moves) {
    const cp = g.clone();
    cp.applyMove(m);
    let sc = -negamax(cp, depth - 1, -Infinity, Infinity, 1);
    if (depth <= 1) sc += Math.random() * 30; // a little variety on Easy
    if (sc > best) {
      best = sc;
      pick = m;
      ties = [m];
    } else if (sc === best) {
      ties.push(m);
    }
  }
  if (depth <= 1 && ties.length) pick = ties[Math.floor(Math.random() * ties.length)];
  return pick;
}
