"use client";

import { Color, PieceType, GLYPH } from "@/lib/engine";

export interface Result {
  title: string;
  sub: string;
}

interface SidePanelProps {
  mode: "human" | "ai";
  onMode: (m: "human" | "ai") => void;
  youPlay: Color;
  onSide: (c: Color) => void;
  difficulty: number;
  onDifficulty: (d: number) => void;

  turn: Color;
  inCheck: boolean;
  thinking: boolean;
  gameOver: boolean;
  result: Result | null;
  locked: boolean;
  onUnlock: () => void;

  capturedByWhite: PieceType[];
  capturedByBlack: PieceType[];
  advantage: number;

  history: { san: string }[];

  soundOn: boolean;
  onToggleSound: () => void;
  onNew: () => void;
  onFlip: () => void;
  onUndo: () => void;
  onShare: () => void;
}

export default function SidePanel(p: SidePanelProps) {
  const side = p.turn === "w" ? "White" : "Black";
  let title: string;
  let sub: string;
  if (p.gameOver && p.result) {
    title = p.result.title;
    sub = p.result.sub;
  } else {
    title = `${side} to move${p.inCheck ? " — check!" : ""}`;
    sub = p.thinking
      ? "Computer is thinking…"
      : p.inCheck
      ? "Get your king to safety"
      : "Tap or drag a piece to move";
  }

  const rows: { n: number; w: string; b: string }[] = [];
  for (let i = 0; i < p.history.length; i += 2) {
    rows.push({ n: i / 2 + 1, w: p.history[i]?.san ?? "", b: p.history[i + 1]?.san ?? "" });
  }

  return (
    <aside className="panel">
      <div className="brand">
        <h1>
          Chess<span className="k">♞</span>
        </h1>
        <span>play a friend or the engine</span>
      </div>

      {p.locked && (
        <div className="banner">
          <span>🔒 Shared game — view only</span>
          <button onClick={p.onUnlock}>Play from here</button>
        </div>
      )}

      <div className="tabs" role="tablist">
        <button className={p.mode === "human" ? "on" : ""} onClick={() => p.onMode("human")} role="tab">
          Two players
        </button>
        <button className={p.mode === "ai" ? "on" : ""} onClick={() => p.onMode("ai")} role="tab">
          Vs computer
        </button>
      </div>

      {p.mode === "ai" && (
        <div className="ai-opts">
          <div className="row">
            <span className="lbl">You play</span>
            <div className="seg">
              <button className={p.youPlay === "w" ? "on" : ""} onClick={() => p.onSide("w")}>White</button>
              <button className={p.youPlay === "b" ? "on" : ""} onClick={() => p.onSide("b")}>Black</button>
            </div>
          </div>
          <div className="row">
            <span className="lbl">Strength</span>
            <div className="seg">
              <button className={p.difficulty === 1 ? "on" : ""} onClick={() => p.onDifficulty(1)}>Easy</button>
              <button className={p.difficulty === 2 ? "on" : ""} onClick={() => p.onDifficulty(2)}>Medium</button>
              <button className={p.difficulty === 3 ? "on" : ""} onClick={() => p.onDifficulty(3)}>Hard</button>
            </div>
          </div>
        </div>
      )}

      <div className="status">
        <div className={"turn-dot " + p.turn} />
        <div>
          <div className="txt">{title}</div>
          <div className="sub">{sub}</div>
        </div>
      </div>

      <div className="captured">
        <div className="cap-row">
          {p.capturedByBlack.map((k, i) => (
            <span className="pc" key={i}>{GLYPH[k]}</span>
          ))}
          {p.advantage < 0 && <span className="adv">+{-p.advantage}</span>}
        </div>
        <div className="cap-row">
          {p.capturedByWhite.map((k, i) => (
            <span className="pc" key={i}>{GLYPH[k]}</span>
          ))}
          {p.advantage > 0 && <span className="adv">+{p.advantage}</span>}
        </div>
      </div>

      <div className="moves">
        {rows.length === 0 ? (
          <div className="empty">Moves will appear here</div>
        ) : (
          rows.map((r) => (
            <div className="mv" key={r.n}>
              <span className="n">{r.n}</span>
              <span className="w">{r.w}</span>
              <span className="b">{r.b}</span>
            </div>
          ))
        )}
      </div>

      <div className="actions">
        <button className="primary wide" onClick={p.onNew}>New game</button>
        <button onClick={p.onFlip}>Flip board</button>
        <button onClick={p.onUndo}>Undo</button>
        <button className="wide" onClick={p.onShare}>🔗 Copy game link</button>
        <button className="wide" aria-pressed={p.soundOn} onClick={p.onToggleSound}>
          {p.soundOn ? "🔊 Sound on" : "🔇 Sound off"}
        </button>
      </div>
    </aside>
  );
}
