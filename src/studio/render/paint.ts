// A scene painted on a 2D canvas (the video's frames) with the light palette
// in plain colours, each shape at the opacity its reveal step is at.

import type { SlideScene, SlideShape } from "./slide-layout.ts";
import { FONT, PALETTE, type Role } from "./svg.ts";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const color = (r?: Role) => (r ? PALETTE[r] : null);

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function fillAndStroke(ctx: Ctx, s: { fill?: Role; stroke?: Role; strokeWidth?: number }, path?: Path2D) {
  const f = color(s.fill);
  const st = color(s.stroke);
  if (f) {
    ctx.fillStyle = f;
    if (path) ctx.fill(path);
    else ctx.fill();
  }
  if (st && (s.strokeWidth ?? 1) > 0) {
    ctx.strokeStyle = st;
    ctx.lineWidth = s.strokeWidth ?? 1;
    if (path) ctx.stroke(path);
    else ctx.stroke();
  }
}

function shape(ctx: Ctx, s: SlideShape) {
  switch (s.kind) {
    case "rect":
      roundRect(ctx, s.x, s.y, s.w, s.h, s.r ?? 0);
      return fillAndStroke(ctx, s);
    case "circle":
      ctx.beginPath();
      ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
      return fillAndStroke(ctx, s);
    case "line":
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.lineCap = "round";
      ctx.setLineDash(s.dash ? [4, 4] : []);
      fillAndStroke(ctx, { stroke: s.stroke, strokeWidth: s.strokeWidth });
      ctx.setLineDash([]);
      return;
    case "path":
      return fillAndStroke(ctx, s, new Path2D(s.d));
    case "text":
      ctx.font = `${s.weight ?? 400} ${s.size}px ${FONT}`;
      ctx.textAlign = s.anchor === "middle" ? "center" : s.anchor === "end" ? "right" : "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color(s.fill) ?? PALETTE.text;
      ctx.fillText(s.text, s.x, s.y);
      return;
  }
}

/** Paint the scene at `alpha`, each shape faded by `reveal(step)` (1 = fully shown). */
export function paintScene(ctx: Ctx, scene: SlideScene, o: { alpha?: number; reveal?: (step: number) => number } = {}) {
  const base = o.alpha ?? 1;
  if (base <= 0) return;
  ctx.save();
  ctx.globalAlpha = base;
  ctx.fillStyle = color(scene.background ?? "bg") ?? "#ffffff";
  ctx.fillRect(0, 0, scene.width, scene.height);
  for (const s of scene.shapes) {
    const a = s.step ? (o.reveal?.(s.step) ?? 1) : 1;
    if (a <= 0) continue;
    ctx.globalAlpha = base * Math.min(1, a);
    shape(ctx, s);
  }
  ctx.restore();
}
