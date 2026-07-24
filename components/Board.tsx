"use client";

import { useEffect, useRef, useState } from "react";
import { BoardT, Move, Color, colorOf, isW, GLYPH, FILES, PieceType } from "@/lib/engine";

interface BoardProps {
  position: BoardT;
  orientation: Color;
  turn: Color;
  lastMove: { from: [number, number]; to: [number, number] } | null;
  checkSquare: [number, number] | null;
  interactive: boolean;
  legalFor: (r: number, c: number) => Move[];
  onMove: (m: Move) => void;
  onCursor?: (x: number, y: number) => void;
  remoteCursor?: { x: number; y: number; label: string } | null;
}

interface Drag { from: [number, number]; piece: string; x: number; y: number; size: number; }

export default function Board({
  position, orientation, turn, lastMove, checkSquare, interactive, legalFor, onMove, onCursor, remoteCursor,
}: BoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<{ from: [number, number]; piece: string } | null>(null);
  const movedRef = useRef(false);

  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [targets, setTargets] = useState<Move[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [promotion, setPromotion] = useState<{ options: Move[]; color: Color } | null>(null);

  const dispToBoard = (dr: number, dc: number): [number, number] =>
    orientation === "w" ? [dr, dc] : [7 - dr, 7 - dc];

  const clearSelection = () => { setSelected(null); setTargets([]); setDrag(null); pressRef.current = null; movedRef.current = false; };

  useEffect(() => { setSelected(null); setTargets([]); setDrag(null); pressRef.current = null; movedRef.current = false; }, [position, orientation]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") clearSelection(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const squareFromEvent = (e: React.PointerEvent): [number, number] | null => {
    const rect = boardRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
    const dc = Math.floor(x / (rect.width / 8));
    const dr = Math.floor(y / (rect.height / 8));
    return dispToBoard(dr, dc);
  };

  const resolveMove = (br: number, bc: number): boolean => {
    const opts = targets.filter((m) => m.to[0] === br && m.to[1] === bc);
    if (opts.length === 0) return false;
    if (opts.length > 1 && opts[0].promotion) { setPromotion({ options: opts, color: turn }); return true; }
    onMove(opts[0]); clearSelection(); return true;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || promotion) return;
    const sq = squareFromEvent(e);
    if (!sq) return;
    const [br, bc] = sq;
    if (selected && targets.some((m) => m.to[0] === br && m.to[1] === bc)) { resolveMove(br, bc); return; }
    const p = position[br][bc];
    if (p && colorOf(p) === turn) {
      setSelected([br, bc]); setTargets(legalFor(br, bc));
      pressRef.current = { from: [br, bc], piece: p }; movedRef.current = false;
      try { boardRef.current!.setPointerCapture(e.pointerId); } catch { /* noop */ }
      e.preventDefault();
    } else { clearSelection(); }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (onCursor && boardRef.current) {
      const rect = boardRef.current.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) onCursor(nx, ny);
    }
    const press = pressRef.current;
    if (!press) return;
    movedRef.current = true;
    const size = boardRef.current ? (boardRef.current.clientWidth / 8) * 0.86 : 40;
    setDrag({ from: press.from, piece: press.piece, x: e.clientX, y: e.clientY, size });
  };

  const endDrag = (e: React.PointerEvent, apply: boolean) => {
    const press = pressRef.current;
    const wasDrag = movedRef.current;
    pressRef.current = null; movedRef.current = false;
    setDrag(null);
    if (apply && wasDrag && press) {
      const sq = squareFromEvent(e);
      if (sq && !(sq[0] === press.from[0] && sq[1] === press.from[1])) resolveMove(sq[0], sq[1]);
    }
  };

  const pickPromotion = (t: PieceType) => {
    const opts = promotion?.options ?? [];
    const m = opts.find((o) => o.promotion === t);
    setPromotion(null);
    if (m) { onMove(m); clearSelection(); }
  };

  const rows = [0, 1, 2, 3, 4, 5, 6, 7];

  return (
    <div className="board-wrap">
      <div
        ref={boardRef}
        className="board"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, true)}
        onPointerCancel={(e) => endDrag(e, false)}
      >
        {rows.map((dr) =>
          rows.map((dc) => {
            const [br, bc] = dispToBoard(dr, dc);
            const p = position[br][bc];
            const target = targets.find((m) => m.to[0] === br && m.to[1] === bc);
            const isLast = !!lastMove && ((lastMove.from[0] === br && lastMove.from[1] === bc) || (lastMove.to[0] === br && lastMove.to[1] === bc));
            const isSel = !!selected && selected[0] === br && selected[1] === bc;
            const isCheck = !!checkSquare && checkSquare[0] === br && checkSquare[1] === bc;
            const hidden = !!drag && drag.from[0] === br && drag.from[1] === bc;
            const light = (br + bc) % 2 === 0;
            const cls = ["sq", light ? "l" : "d"];
            if (isLast) cls.push("last");
            if (isSel) cls.push("sel");
            if (isCheck) cls.push("check");
            return (
              <div key={`${dr}-${dc}`} className={cls.join(" ")}>
                {dc === 0 && <span className="coord r">{8 - br}</span>}
                {dr === 7 && <span className="coord f">{FILES[bc]}</span>}
                {target && <div className={p || target.enpassant ? "ring" : "dot"} />}
                {p && !hidden && (<div className={"piece " + (isW(p) ? "w" : "b")}>{GLYPH[p.toLowerCase() as PieceType]}</div>)}
              </div>
            );
          })
        )}
      </div>

      {remoteCursor && (
        <div className="remote-cursor" style={{ left: remoteCursor.x * 100 + "%", top: remoteCursor.y * 100 + "%" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 2 L4 20 L9 15 L12.5 22 L15.5 20.7 L12 14 L19 14 Z" fill="#e8b45f" stroke="#241f18" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
          <span className="rc-label">{remoteCursor.label}</span>
        </div>
      )}

      {promotion && (
        <div className="promo show">
          <div className={"promo-box " + promotion.color}>
            {(["q", "r", "b", "n"] as PieceType[]).map((t) => (
              <button key={t} onClick={() => pickPromotion(t)} aria-label={`Promote to ${t}`}>{GLYPH[t]}</button>
            ))}
          </div>
        </div>
      )}

      {drag && (
        <div className={"piece ghost " + (isW(drag.piece) ? "w" : "b")} style={{ left: drag.x, top: drag.y, fontSize: drag.size }}>
          {GLYPH[drag.piece.toLowerCase() as PieceType]}
        </div>
      )}
    </div>
  );
}
