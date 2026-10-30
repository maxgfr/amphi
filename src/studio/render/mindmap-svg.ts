// The mind map as a scene, for the SVG and PNG files: the same layout and
// colours as the editor, drawn with explicit colours.

import { type Box, edgePath, LAYOUT, type Layout } from "./mindmap-layout.ts";
import { type MindNode, toOutline } from "./mindmap-tree.ts";
import { branch, branchSoft, type Role, type Scene, type Shape } from "./svg.ts";

/** Fill, stroke and text colours of a box. */
export function boxColours(b: Box): { fill: Role; stroke: Role; text: Role } {
  if (b.depth === 0) return { fill: "accent", stroke: "accent", text: "accentInk" };
  if (b.depth === 1) return { fill: branchSoft(b.branch), stroke: branch(b.branch), text: "text" };
  return { fill: "surface", stroke: branch(b.branch), text: "text" };
}

/** Where a box's text lines sit (vertical centres). */
export const lineYs = (b: Box) => b.lines.map((_, i) => b.y + LAYOUT.padY + b.size * LAYOUT.lineHeight * (i + 0.5));

export function mindmapScene(layout: Layout, root: MindNode): Scene {
  const byId = new Map(layout.boxes.map((b) => [b.id, b]));
  const shapes: Shape[] = [];
  for (const b of layout.boxes) {
    const p = b.parentId ? byId.get(b.parentId) : undefined;
    if (p) shapes.push({ kind: "path", d: edgePath(p, b), stroke: branch(b.branch), strokeWidth: 2 });
  }
  for (const b of layout.boxes) {
    const c = boxColours(b);
    shapes.push({ kind: "rect", x: b.x, y: b.y, w: b.w, h: b.h, r: 8, fill: c.fill, stroke: c.stroke, strokeWidth: b.depth === 0 ? 0 : 1.5 });
    lineYs(b).forEach((y, i) => shapes.push({ kind: "text", x: b.x + LAYOUT.padX, y, text: b.lines[i]!, size: b.size, weight: b.weight, fill: c.text }));
    if (b.hidden) {
      shapes.push({ kind: "circle", cx: b.x + b.w, cy: b.y + b.h / 2, r: 11, fill: "surface", stroke: b.depth === 0 ? "accent" : branch(b.branch), strokeWidth: 1.5 });
      shapes.push({ kind: "text", x: b.x + b.w, y: b.y + b.h / 2, text: `+${b.hidden}`, size: 10, weight: 600, fill: "muted", anchor: "middle" });
    }
  }
  return { width: layout.width, height: layout.height, title: root.title, desc: toOutline(root), shapes };
}
