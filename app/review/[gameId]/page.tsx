"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import { getGame, GameDoc } from "@/lib/gameStore";

function resultLine(g: GameDoc): { text: string; tone: "win" | "draw" } {
  const r = g.result;
  if (!r) return { text: "Result unavailable", tone: "draw" };
  if (r.kind === "draw" || r.kind === "stalemate")
    return { text: "Draw", tone: "draw" };
  const winnerNick = r.winner === "w" ? g.white?.nick : g.black?.nick;
  const how =
    r.kind === "checkmate"
      ? " by checkmate"
      : r.kind === "timeout"
        ? " on time"
        : r.kind === "resign"
          ? " by resignation"
          : r.kind === "abandon"
            ? " by abandonment"
            : "";
  return {
    text: `${winnerNick || (r.winner === "w" ? "White" : "Black")} won${how}`,
    tone: "win",
  };
}

export default function ReviewPage() {
  const params = useParams();
  const gameId = String(params.gameId ?? "");
  const [game, setGame] = useState<GameDoc | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    if (!gameId) {
      setGame(null);
      return;
    }
    getGame(gameId)
      .then(setGame)
      .catch(() => setGame(null));
  }, [gameId]);

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.brand}>
          Chess<span style={{ color: "#d7a95c" }}>♟</span>
        </div>
        <div style={s.tag}>Game review</div>

        {game === undefined && <p style={s.muted}>Loading…</p>}

        {game === null && (
          <>
            <p style={s.muted}>
              This game link is invalid or no longer available.
            </p>
            <div style={s.btns}>
              <a href="/#new=1" style={s.primary}>
                New game
              </a>
              <a href="/" style={s.ghost}>
                Home
              </a>
            </div>
          </>
        )}

        {game && game.status !== "finished" && (
          <>
            <p style={s.muted}>This game is still in progress.</p>
            <div style={s.btns}>
              <a href={`/#live=${gameId}`} style={s.primary}>
                Open game
              </a>
              <a href="/" style={s.ghost}>
                Home
              </a>
            </div>
          </>
        )}

        {game &&
          game.status === "finished" &&
          (() => {
            const rl = resultLine(game);
            const moves = game.moves?.length ?? game.ply ?? 0;
            return (
              <>
                <div
                  style={{
                    ...s.result,
                    color: rl.tone === "win" ? "#6fce7d" : "#e8e2d4",
                  }}
                >
                  {rl.text}
                </div>

                <div style={s.players}>
                  <div style={s.prow}>
                    <span style={s.dotW} />
                    <span style={s.pnick}>{game.white?.nick ?? "—"}</span>
                    <span style={s.pelo}>{game.white?.rating ?? "—"}</span>
                  </div>
                  <div style={s.prow}>
                    <span style={s.dotB} />
                    <span style={s.pnick}>{game.black?.nick ?? "—"}</span>
                    <span style={s.pelo}>{game.black?.rating ?? "—"}</span>
                  </div>
                </div>

                <div style={s.meta}>
                  {moves} move{moves === 1 ? "" : "s"}
                  {game.tcId && game.tcId !== "none" ? ` · ${game.tcId}` : ""}
                  {game.rated ? " · rated" : " · casual"}
                </div>

                <div style={s.btns}>
                  <a href="/#new=1" style={s.primary}>
                    New game
                  </a>
                  <a href="/" style={s.ghost}>
                    Home
                  </a>
                </div>
              </>
            );
          })()}
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#262421",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    textAlign: "center",
    background: "#302e2b",
    border: "1px solid #443f3a",
    borderRadius: 18,
    padding: "34px 28px",
    boxShadow: "0 30px 80px rgba(0,0,0,.6)",
    borderTop: "5px solid #d7a95c",
  },
  brand: {
    fontFamily: "Georgia, serif",
    fontSize: 30,
    fontWeight: 700,
    color: "#ece8e0",
  },
  tag: {
    color: "#9b948a",
    fontSize: 13,
    fontWeight: 600,
    margin: "2px 0 20px",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  muted: { color: "#9b948a", fontSize: 14, margin: "10px 0 22px" },
  result: { fontSize: 22, fontWeight: 800, margin: "6px 0 20px" },
  players: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 16,
  },
  prow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#262421",
    border: "1px solid #443f3a",
    borderRadius: 10,
    padding: "10px 14px",
  },
  dotW: {
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: "#f0ead6",
    border: "1px solid #8a8378",
    flex: "0 0 auto",
  },
  dotB: {
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: "#3a3733",
    border: "1px solid #8a8378",
    flex: "0 0 auto",
  },
  pnick: {
    flex: 1,
    textAlign: "left",
    color: "#ece8e0",
    fontSize: 15,
    fontWeight: 700,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  pelo: {
    color: "#d7a95c",
    fontWeight: 800,
    fontSize: 13,
    fontVariantNumeric: "tabular-nums",
  },
  meta: { color: "#9b948a", fontSize: 12, fontWeight: 600, marginBottom: 22 },
  btns: { display: "flex", gap: 10, justifyContent: "center" },
  primary: {
    textDecoration: "none",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 700,
    padding: "11px 18px",
    borderRadius: 10,
    background: "#d7a95c",
    color: "#241f18",
  },
  ghost: {
    textDecoration: "none",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 700,
    padding: "11px 18px",
    borderRadius: 10,
    background: "transparent",
    color: "#ece8e0",
    border: "1px solid #443f3a",
  },
};
