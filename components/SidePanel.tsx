"use client";

import { Color, PieceType, GLYPH } from "@/lib/engine";
import { Lang, tr, TKey } from "@/lib/i18n";

export type GameResult =
  | { kind: "checkmate"; winner: Color }
  | { kind: "stalemate" }
  | { kind: "draw"; reason: "fifty" | "insufficient" | "threefold" };

export type OnlineState =
  | { role: "host" | "guest"; myColor: Color; status: "waiting" | "connected" | "disconnected" }
  | null;

type Rematch = "none" | "sent" | "received";

interface SidePanelProps {
  lang: Lang;
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
  result: GameResult | null;
  locked: boolean;
  onUnlock: () => void;

  online: OnlineState;
  rematch: Rematch;
  onInvite: () => void;
  onLeaveOnline: () => void;
  onRematchAccept: () => void;
  onRematchDecline: () => void;

  capturedByWhite: PieceType[];
  capturedByBlack: PieceType[];
  advantage: number;

  history: { san: string }[];

  soundOn: boolean;
  onToggleSound: () => void;
  onNew: () => void;
  onFlip: () => void;
  onUndo: () => void;
}

function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.().catch(() => {});
}

export default function SidePanel(p: SidePanelProps) {
  const t = (k: TKey) => tr(p.lang, k);
  const online = p.online;

  let title: string;
  let sub: string;
  if (p.gameOver && p.result) {
    const r = p.result;
    if (r.kind === "checkmate") { title = t("checkmate"); sub = r.winner === "w" ? t("whiteWins") : t("blackWins"); }
    else if (r.kind === "stalemate") { title = t("stalemate"); sub = t("stalemateSub"); }
    else { title = t("draw"); sub = r.reason === "fifty" ? t("fifty") : r.reason === "insufficient" ? t("insufficient") : t("threefold"); }
  } else if (online && online.status !== "connected") {
    title = online.status === "waiting" ? t("waitingOpp") : t("opponentLeft");
    sub = online.status === "waiting" ? t("shareToStart") : t("newOrInvite");
  } else {
    const yourMove = online ? online.myColor === p.turn : true;
    title = (p.turn === "w" ? t("whiteToMove") : t("blackToMove")) + (p.inCheck ? t("checkSuffix") : "");
    sub = p.thinking
      ? t("thinking")
      : online
      ? yourMove ? t("yourMove") : t("opponentMove")
      : p.inCheck
      ? t("getKingSafe")
      : t("tapToMove");
  }

  const rows: { n: number; w: string; b: string }[] = [];
  for (let i = 0; i < p.history.length; i += 2) {
    rows.push({ n: i / 2 + 1, w: p.history[i]?.san ?? "", b: p.history[i + 1]?.san ?? "" });
  }

  return (
    <aside className="panel">
      <div className="brand">
        <h1>Chess<span className="k">♞</span></h1>
        <span>{t("tagline")}</span>
      </div>

      {p.locked && (
        <div className="banner">
          <span>{t("sharedViewOnly")}</span>
          <button onClick={p.onUnlock}>{t("playFromHere")}</button>
        </div>
      )}

      {online && (
        <div className={"banner live " + online.status}>
          <span className="live-dot" />
          <span>
            {online.status === "waiting" && t("waitingFriend")}
            {online.status === "connected" && (online.myColor === "w" ? t("liveWhite") : t("liveBlack"))}
            {online.status === "disconnected" && t("oppDisconnected")}
          </span>
          <button onClick={p.onLeaveOnline}>{t("leave")}</button>
        </div>
      )}

      {p.rematch === "received" && (
        <div className="banner rematch">
          <span>{t("wantsRematch")}</span>
          <div className="rematch-btns">
            <button className="ok" onClick={p.onRematchAccept}>{t("accept")}</button>
            <button onClick={p.onRematchDecline}>{t("decline")}</button>
          </div>
        </div>
      )}
      {p.rematch === "sent" && (
        <div className="banner"><span>{t("waitingAccept")}</span></div>
      )}

      {!online && (
        <div className="tabs" role="tablist">
          <button className={p.mode === "human" ? "on" : ""} onClick={() => p.onMode("human")} role="tab">{t("twoPlayers")}</button>
          <button className={p.mode === "ai" ? "on" : ""} onClick={() => p.onMode("ai")} role="tab">{t("vsComputer")}</button>
        </div>
      )}

      {p.mode === "ai" && !online && (
        <div className="ai-opts">
          <div className="row">
            <span className="lbl">{t("youPlay")}</span>
            <div className="seg">
              <button className={p.youPlay === "w" ? "on" : ""} onClick={() => p.onSide("w")}>{t("white")}</button>
              <button className={p.youPlay === "b" ? "on" : ""} onClick={() => p.onSide("b")}>{t("black")}</button>
            </div>
          </div>
          <div className="row">
            <span className="lbl">{t("strength")}</span>
            <div className="seg">
              <button className={p.difficulty === 1 ? "on" : ""} onClick={() => p.onDifficulty(1)}>{t("easy")}</button>
              <button className={p.difficulty === 2 ? "on" : ""} onClick={() => p.onDifficulty(2)}>{t("medium")}</button>
              <button className={p.difficulty === 3 ? "on" : ""} onClick={() => p.onDifficulty(3)}>{t("hard")}</button>
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
          {p.capturedByBlack.map((k, i) => (<span className="pc" key={i}>{GLYPH[k]}</span>))}
          {p.advantage < 0 && <span className="adv">+{-p.advantage}</span>}
        </div>
        <div className="cap-row">
          {p.capturedByWhite.map((k, i) => (<span className="pc" key={i}>{GLYPH[k]}</span>))}
          {p.advantage > 0 && <span className="adv">+{p.advantage}</span>}
        </div>
      </div>

      <div className="moves">
        {rows.length === 0 ? (
          <div className="empty">{t("movesHere")}</div>
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
        <button className="primary wide" onClick={p.onNew}>{t("newGame")}</button>
        <button onClick={p.onFlip}>{t("flip")}</button>
        <button onClick={p.onUndo} disabled={!!online}>{t("undo")}</button>
        {!online && <button className="wide invite" onClick={p.onInvite}>{t("playLive")}</button>}
        <button onClick={toggleFullscreen}>{t("fullscreen")}</button>
        <button aria-pressed={p.soundOn} onClick={p.onToggleSound}>{p.soundOn ? t("sound") : t("muted")}</button>
      </div>
    </aside>
  );
}
