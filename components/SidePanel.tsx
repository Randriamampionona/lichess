"use client";

import { Color, PieceType, GLYPH } from "@/lib/engine";
import { Lang, tr, TKey } from "@/lib/i18n";

export type GameResult =
  | { kind: "checkmate"; winner: Color }
  | { kind: "timeout"; winner: Color }
  | { kind: "stalemate" }
  | { kind: "draw"; reason: "fifty" | "insufficient" | "threefold" };

export type Role = "w" | "b" | "spec";
export type OnlineState =
  | { role: Role; status: "waiting" | "connected" | "disconnected"; whiteNick: string; blackNick: string | null }
  | null;

export type TcId = "none" | "3+2" | "5+0" | "10+0";
type Rematch = "none" | "sent" | "received";

interface SidePanelProps {
  lang: Lang;
  mode: "human" | "ai";
  onMode: (m: "human" | "ai") => void;
  youPlay: Color;
  onSide: (c: Color) => void;
  difficulty: number;
  onDifficulty: (d: number) => void;
  tcId: TcId;
  onTcId: (id: TcId) => void;
  settingsLocked: boolean;

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
  onResign: () => void;

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

const TC_LIST: { id: TcId; label: string }[] = [
  { id: "none", label: "∞" }, { id: "3+2", label: "3+2" }, { id: "5+0", label: "5+0" }, { id: "10+0", label: "10+0" },
];

function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.().catch(() => {});
}

export default function SidePanel(p: SidePanelProps) {
  const t = (k: TKey) => tr(p.lang, k);
  const online = p.online;
  const isSpec = online?.role === "spec";
  const isPlayer = !!online && online.role !== "spec";
  const tcDisabled = p.settingsLocked || (!!online && online.role !== "w");

  let title: string;
  let sub: string;
  if (p.gameOver && p.result) {
    const r = p.result;
    if (r.kind === "checkmate") { title = t("checkmate"); sub = r.winner === "w" ? t("whiteWins") : t("blackWins"); }
    else if (r.kind === "timeout") { title = t("timesUp"); sub = r.winner === "w" ? t("whiteWins") : t("blackWins"); }
    else if (r.kind === "stalemate") { title = t("stalemate"); sub = t("stalemateSub"); }
    else { title = t("draw"); sub = r.reason === "fifty" ? t("fifty") : r.reason === "insufficient" ? t("insufficient") : t("threefold"); }
  } else if (online && online.status !== "connected") {
    title = online.status === "waiting" ? t("waitingOpp") : t("opponentLeft");
    sub = online.status === "waiting" ? t("shareToStart") : t("newOrInvite");
  } else {
    title = (p.turn === "w" ? t("whiteToMove") : t("blackToMove")) + (p.inCheck ? t("checkSuffix") : "");
    const yourMove = isPlayer ? online!.role === p.turn : true;
    sub = p.thinking ? t("thinking")
      : isSpec ? t("specHint")
      : online ? (yourMove ? t("yourMove") : t("opponentMove"))
      : p.inCheck ? t("getKingSafe") : t("tapToMove");
  }

  const rows: { n: number; w: string; b: string }[] = [];
  for (let i = 0; i < p.history.length; i += 2) rows.push({ n: i / 2 + 1, w: p.history[i]?.san ?? "", b: p.history[i + 1]?.san ?? "" });

  const canResign = isPlayer && online!.status === "connected" && !p.gameOver;

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
          <span>{online.whiteNick} vs {online.blackNick ?? "…"}</span>
          <button onClick={p.onLeaveOnline}>{t("leave")}</button>
        </div>
      )}
      {isSpec && <div className="banner spec"><span>{t("spectating")} — {t("specHint")}</span></div>}

      {p.rematch === "received" && (
        <div className="banner rematch">
          <span>{t("wantsRematch")}</span>
          <div className="rematch-btns">
            <button className="ok" onClick={p.onRematchAccept}>{t("accept")}</button>
            <button onClick={p.onRematchDecline}>{t("decline")}</button>
          </div>
        </div>
      )}
      {p.rematch === "sent" && <div className="banner"><span>{t("waitingAccept")}</span></div>}

      {!online && (
        <div className="tabs" role="tablist">
          <button className={p.mode === "human" ? "on" : ""} disabled={p.settingsLocked} onClick={() => p.onMode("human")} role="tab">{t("twoPlayers")}</button>
          <button className={p.mode === "ai" ? "on" : ""} disabled={p.settingsLocked} onClick={() => p.onMode("ai")} role="tab">{t("vsComputer")}</button>
        </div>
      )}

      {p.mode === "ai" && !online && (
        <div className="ai-opts">
          <div className="row">
            <span className="lbl">{t("youPlay")}</span>
            <div className="seg">
              <button className={p.youPlay === "w" ? "on" : ""} disabled={p.settingsLocked} onClick={() => p.onSide("w")}>{t("white")}</button>
              <button className={p.youPlay === "b" ? "on" : ""} disabled={p.settingsLocked} onClick={() => p.onSide("b")}>{t("black")}</button>
            </div>
          </div>
          <div className="row">
            <span className="lbl">{t("strength")}</span>
            <div className="seg">
              <button className={p.difficulty === 1 ? "on" : ""} disabled={p.settingsLocked} onClick={() => p.onDifficulty(1)}>{t("easy")}</button>
              <button className={p.difficulty === 2 ? "on" : ""} disabled={p.settingsLocked} onClick={() => p.onDifficulty(2)}>{t("medium")}</button>
              <button className={p.difficulty === 3 ? "on" : ""} disabled={p.settingsLocked} onClick={() => p.onDifficulty(3)}>{t("hard")}</button>
              <button className={p.difficulty === 4 ? "on" : ""} disabled={p.settingsLocked} onClick={() => p.onDifficulty(4)}>{t("expert")}</button>
            </div>
          </div>
        </div>
      )}

      <div className="row">
        <span className="lbl">{t("time")}</span>
        <div className="seg">
          {TC_LIST.map((tc) => (
            <button key={tc.id} className={p.tcId === tc.id ? "on" : ""} disabled={tcDisabled} onClick={() => p.onTcId(tc.id)}>{tc.label}</button>
          ))}
        </div>
      </div>

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
        {rows.length === 0 ? (<div className="empty">{t("movesHere")}</div>) : (
          rows.map((r) => (
            <div className="mv" key={r.n}>
              <span className="n">{r.n}</span><span className="w">{r.w}</span><span className="b">{r.b}</span>
            </div>
          ))
        )}
      </div>

      <div className="actions">
        <button className="primary wide" disabled={isSpec} onClick={p.onNew}>{t("newGame")}</button>
        <button onClick={p.onFlip}>{t("flip")}</button>
        <button onClick={p.onUndo} disabled={!!online}>{t("undo")}</button>
        {canResign && <button className="wide resign" onClick={p.onResign}>{t("resignBtn")}</button>}
        {!online && <button className="wide invite" onClick={p.onInvite}>{t("playLive")}</button>}
        <button onClick={toggleFullscreen}>{t("fullscreen")}</button>
        <button aria-pressed={p.soundOn} onClick={p.onToggleSound}>{p.soundOn ? t("sound") : t("muted")}</button>
      </div>
    </aside>
  );
}
