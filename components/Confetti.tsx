"use client";

import { useEffect, useRef } from "react";

export default function Confetti({ fire }: { fire: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!fire) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = (canvas.width = window.innerWidth * dpr);
    const H = (canvas.height = window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";

    const colors = [
      "#d7a95c",
      "#f2c266",
      "#6fce7d",
      "#e5603c",
      "#5aa0e0",
      "#e8e2d4",
    ];
    const N = 160;
    type P = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      c: string;
      rot: number;
      vr: number;
      life: number;
    };
    const parts: P[] = Array.from({ length: N }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = (4 + Math.random() * 7) * dpr;
      return {
        x: W / 2,
        y: H * 0.35,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4 * dpr,
        r: (4 + Math.random() * 5) * dpr,
        c: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        life: 1,
      };
    });

    const gravity = 0.18 * dpr;
    let raf = 0;
    const start = performance.now();

    const draw = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      parts.forEach((p) => {
        p.vy += gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.99;
        p.rot += p.vr;
        p.life = Math.max(0, 1 - t / 2600);
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
        ctx.restore();
      });
      if (t < 2800) raf = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [fire]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 100,
      }}
    />
  );
}
