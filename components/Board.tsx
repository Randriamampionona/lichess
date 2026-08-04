"use client";

import { useEffect, useRef, useState } from "react";
import {
  BoardT,
  Move,
  Color,
  colorOf,
  isW,
  GLYPH,
  FILES,
  PieceType,
} from "@/lib/engine";

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

interface Drag {
  from: [number, number];
  piece: string;
  x: number;
  y: number;
  size: number;
}
type Sq = [number, number];
type Arrow = { from: Sq; to: Sq };

const ARROW_COLOR = "rgba(231, 90, 60, 0.82)";

export default function Board({
  position,
  orientation,
  turn,
  lastMove,
  checkSquare,
  interactive,
  legalFor,
  onMove,
  onCursor,
  remoteCursor,
}: BoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<{ from: [number, number]; piece: string } | null>(
    null,
  );
  const movedRef = useRef(false);
  const rightDownRef = useRef<Sq | null>(null);

  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [targets, setTargets] = useState<Move[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [promotion, setPromotion] = useState<{
    options: Move[];
    color: Color;
  } | null>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [highlights, setHighlights] = useState<Sq[]>([]);

  const dispToBoard = (dr: number, dc: number): [number, number] =>
    orientation === "w" ? [dr, dc] : [7 - dr, 7 - dc];

  const clearSelection = () => {
    setSelected(null);
    setTargets([]);
    setDrag(null);
    pressRef.current = null;
    movedRef.current = false;
  };
  const clearAnnotations = () => {
    setArrows([]);
    setHighlights([]);
  };
  const sameSq = (a: Sq, b: Sq) => a[0] === b[0] && a[1] === b[1];

  useEffect(() => {
    setSelected(null);
    setTargets([]);
    setDrag(null);
    pressRef.current = null;
    movedRef.current = false;
  }, [position, orientation]);
  useEffect(() => {
    setArrows([]);
    setHighlights([]);
  }, [position]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearSelection();
        clearAnnotations();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const squareFromEvent = (e: React.PointerEvent): [number, number] | null => {
    const rect = boardRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
    const dc = Math.floor(x / (rect.width / 8));
    const dr = Math.floor(y / (rect.height / 8));
    return dispToBoard(dr, dc);
  };

  const resolveMove = (br: number, bc: number): boolean => {
    const opts = targets.filter((m) => m.to[0] === br && m.to[1] === bc);
    if (opts.length === 0) return false;
    if (opts.length > 1 && opts[0].promotion) {
      setPromotion({ options: opts, color: turn });
      return true;
    }
    onMove(opts[0]);
    clearSelection();
    return true;
  };

  const toggleHighlight = (sq: Sq) =>
    setHighlights((hs) =>
      hs.some((h) => sameSq(h, sq))
        ? hs.filter((h) => !sameSq(h, sq))
        : [...hs, sq],
    );
  const toggleArrow = (from: Sq, to: Sq) =>
    setArrows((as) =>
      as.some((a) => sameSq(a.from, from) && sameSq(a.to, to))
        ? as.filter((a) => !(sameSq(a.from, from) && sameSq(a.to, to)))
        : [...as, { from, to }],
    );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) {
      rightDownRef.current = squareFromEvent(e);
      try {
        boardRef.current!.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      return;
    }
    if (arrows.length || highlights.length) clearAnnotations();
    if (!interactive || promotion) return;
    const sq = squareFromEvent(e);
    if (!sq) return;
    const [br, bc] = sq;
    if (selected && targets.some((m) => m.to[0] === br && m.to[1] === bc)) {
      resolveMove(br, bc);
      return;
    }
    const p = position[br][bc];
    if (p && colorOf(p) === turn) {
      setSelected([br, bc]);
      setTargets(legalFor(br, bc));
      pressRef.current = { from: [br, bc], piece: p };
      movedRef.current = false;
      try {
        boardRef.current!.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      e.preventDefault();
    } else {
      clearSelection();
    }
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
    const size = boardRef.current
      ? (boardRef.current.clientWidth / 8) * 0.86
      : 40;
    setDrag({
      from: press.from,
      piece: press.piece,
      x: e.clientX,
      y: e.clientY,
      size,
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.button === 2) {
      const from = rightDownRef.current;
      rightDownRef.current = null;
      if (from) {
        const to = squareFromEvent(e);
        if (to) {
          if (sameSq(from, to)) toggleHighlight(from);
          else toggleArrow(from, to);
        }
      }
      return;
    }
    endDrag(e, true);
  };

  const endDrag = (e: React.PointerEvent, apply: boolean) => {
    const press = pressRef.current;
    const wasDrag = movedRef.current;
    pressRef.current = null;
    movedRef.current = false;
    setDrag(null);
    if (apply && wasDrag && press) {
      const sq = squareFromEvent(e);
      if (sq && !(sq[0] === press.from[0] && sq[1] === press.from[1]))
        resolveMove(sq[0], sq[1]);
    }
  };

  const pickPromotion = (t: PieceType) => {
    const opts = promotion?.options ?? [];
    const m = opts.find((o) => o.promotion === t);
    setPromotion(null);
    if (m) {
      onMove(m);
      clearSelection();
    }
  };

  const rows = [0, 1, 2, 3, 4, 5, 6, 7];
  const rankLabels = rows.map((dr) => 8 - dispToBoard(dr, 0)[0]);
  const fileLabels = rows.map((dc) => FILES[dispToBoard(0, dc)[1]]);

  const arrowGeo = (a: Arrow) => {
    const [fr, fc] = dispToBoard(a.from[0], a.from[1]);
    const [tr2, tc] = dispToBoard(a.to[0], a.to[1]);
    const x1 = fc + 0.5,
      y1 = fr + 0.5,
      x2 = tc + 0.5,
      y2 = tr2 + 0.5;
    const adr = Math.abs(a.to[0] - a.from[0]);
    const adc = Math.abs(a.to[1] - a.from[1]);
    const knight = (adr === 1 && adc === 2) || (adr === 2 && adc === 1);
    const headLen = 0.34,
      headW = 0.28;

    // knight arrows bend into an L: travel the longer display axis first, then turn
    let cx = x1,
      cy = y1;
    if (knight) {
      if (Math.abs(x2 - x1) > Math.abs(y2 - y1)) {
        cx = x2;
        cy = y1;
      } else {
        cx = x1;
        cy = y2;
      }
    }
    const lx = knight ? cx : x1,
      ly = knight ? cy : y1; // start of the final (arrowhead) leg
    const dx = x2 - lx,
      dy = y2 - ly;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len,
      uy = dy / len;
    const ex = x2 - ux * headLen,
      ey = y2 - uy * headLen; // shaft stops before the head
    const px = -uy,
      py = ux;
    const pts = knight
      ? `${x1},${y1} ${cx},${cy} ${ex},${ey}`
      : `${x1},${y1} ${ex},${ey}`;
    const head = `${x2},${y2} ${ex + px * headW},${ey + py * headW} ${ex - px * headW},${ey - py * headW}`;
    return { pts, head };
  };

  return (
    <div className="board-frame">
      <div className="board-wrap">
        <div
          ref={boardRef}
          className="board"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={(e) => endDrag(e, false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {rows.map((dr) =>
            rows.map((dc) => {
              const [br, bc] = dispToBoard(dr, dc);
              const p = position[br][bc];
              const target = targets.find(
                (m) => m.to[0] === br && m.to[1] === bc,
              );
              const isLast =
                !!lastMove &&
                ((lastMove.from[0] === br && lastMove.from[1] === bc) ||
                  (lastMove.to[0] === br && lastMove.to[1] === bc));
              const isSel =
                !!selected && selected[0] === br && selected[1] === bc;
              const isCheck =
                !!checkSquare && checkSquare[0] === br && checkSquare[1] === bc;
              const isHi = highlights.some((h) => h[0] === br && h[1] === bc);
              const hidden =
                !!drag && drag.from[0] === br && drag.from[1] === bc;
              const light = (br + bc) % 2 === 0;
              const cls = ["sq", light ? "l" : "d"];
              if (isLast) cls.push("last");
              if (isSel) cls.push("sel");
              if (isCheck) cls.push("check");
              if (isHi) cls.push("hi");
              return (
                <div key={`${dr}-${dc}`} className={cls.join(" ")}>
                  {target && (
                    <div className={p || target.enpassant ? "ring" : "dot"} />
                  )}
                  {p && !hidden && (
                    <div className={"piece " + (isW(p) ? "w" : "b")}>
                      {GLYPH[p.toLowerCase() as PieceType]}
                    </div>
                  )}
                </div>
              );
            }),
          )}
        </div>

        {arrows.length > 0 && (
          <svg className="annot-arrows" viewBox="0 0 8 8" aria-hidden="true">
            {arrows.map((a, i) => {
              const g = arrowGeo(a);
              return (
                <g key={i}>
                  <polyline
                    points={g.pts}
                    fill="none"
                    stroke={ARROW_COLOR}
                    strokeWidth={0.16}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <polygon points={g.head} fill={ARROW_COLOR} />
                </g>
              );
            })}
          </svg>
        )}

        {remoteCursor && (
          <div
            className="remote-cursor"
            style={{
              left: remoteCursor.x * 100 + "%",
              top: remoteCursor.y * 100 + "%",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 2 L4 20 L9 15 L12.5 22 L15.5 20.7 L12 14 L19 14 Z"
                fill="#e8b45f"
                stroke="#241f18"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
            <span className="rc-label">{remoteCursor.label}</span>
          </div>
        )}

        {promotion && (
          <div className="promo show">
            <div className={"promo-box " + promotion.color}>
              {(["q", "r", "b", "n"] as PieceType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => pickPromotion(t)}
                  aria-label={`Promote to ${t}`}
                >
                  {GLYPH[t]}
                </button>
              ))}
            </div>
          </div>
        )}

        {drag && (
          <div
            className={"piece ghost " + (isW(drag.piece) ? "w" : "b")}
            style={{ left: drag.x, top: drag.y, fontSize: drag.size }}
          >
            {GLYPH[drag.piece.toLowerCase() as PieceType]}
          </div>
        )}
      </div>

      <div className="ranks">
        {rankLabels.map((n, i) => (
          <span key={i}>{n}</span>
        ))}
      </div>
      <div className="files">
        {fileLabels.map((f, i) => (
          <span key={i}>{f}</span>
        ))}
      </div>
    </div>
  );
}
