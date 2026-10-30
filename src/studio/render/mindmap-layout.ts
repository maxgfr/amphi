// A horizontal tidy tree: the central topic on the left, each level in its
// own column, every subtree stacked under the previous one and each parent
// centred on its children, so no two boxes ever overlap. A pure function of
// the tree (and of how wide text is), drawn by the editor and the exports.

import type { MindNode } from "./mindmap-tree.ts";
import { textWidth, wrap } from "./svg.ts";

export interface Box {
  id: string;
  node: MindNode;
  depth: number;
  /** Which first-level branch it belongs to (its colour); -1 for the central topic. */
  branch: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  size: number;
  weight: number;
  /** Nodes hidden under a collapsed node. */
  hidden: number;
  parentId?: string;
}

export interface Layout {
  boxes: Box[];
  width: number;
  height: number;
}

export const LAYOUT = { margin: 24, hgap: 56, vgap: 10, branchGap: 22, padX: 12, padY: 8, lineHeight: 1.3, maxLines: 4 };

const style = (depth: number) => (depth === 0 ? { size: 18, weight: 700, max: 240 } : depth === 1 ? { size: 15, weight: 600, max: 220 } : { size: 14, weight: 400, max: 200 });

const descendants = (n: MindNode): number => n.children.reduce((s, c) => s + 1 + descendants(c), 0);

export function layoutTree(root: MindNode): Layout {
  const L = LAYOUT;
  const boxes: Box[] = [];
  const colWidth: number[] = [];

  // First pass: sizes, and the widest box of each column.
  const sized = new Map<string, Box>();
  const measure = (n: MindNode, depth: number, branch: number, parentId?: string) => {
    const st = style(depth);
    const lines = wrap(n.title, st.size, st.max, st.weight, L.maxLines);
    const w = Math.max(48, Math.ceil(Math.max(...lines.map((l) => textWidth(l, st.size, st.weight)))) + L.padX * 2);
    const h = Math.ceil(lines.length * st.size * L.lineHeight) + L.padY * 2;
    const box: Box = { id: n.id, node: n, depth, branch, x: 0, y: 0, w, h, lines, size: st.size, weight: st.weight, hidden: n.collapsed ? descendants(n) : 0, parentId };
    sized.set(n.id, box);
    boxes.push(box);
    colWidth[depth] = Math.max(colWidth[depth] ?? 0, w);
    if (!n.collapsed) n.children.forEach((c, i) => measure(c, depth + 1, depth === 0 ? i : branch, n.id));
  };
  measure(root, 0, -1);

  const colX: number[] = [];
  colWidth.forEach((w, d) => {
    colX[d] = d === 0 ? L.margin : colX[d - 1]! + colWidth[d - 1]! + L.hgap;
  });

  // Second pass: each subtree takes a band of height; the node sits at the centre of its children.
  const place = (n: MindNode, top: number): number => {
    const box = sized.get(n.id)!;
    box.x = colX[box.depth]!;
    const kids = n.collapsed ? [] : n.children;
    if (!kids.length) {
      box.y = top;
      return box.h;
    }
    const gap = box.depth === 0 ? L.branchGap : L.vgap;
    // Lay the children out first to know their band.
    let cursor = top;
    for (const c of kids) {
      cursor += place(c, cursor) + gap;
    }
    const band = cursor - gap - top;
    const first = sized.get(kids[0]!.id)!;
    const last = sized.get(kids.at(-1)!.id)!;
    const centre = (first.y + first.h / 2 + last.y + last.h / 2) / 2;
    if (box.h <= band) {
      box.y = Math.max(top, Math.min(top + band - box.h, centre - box.h / 2));
      return band;
    }
    // A parent taller than its children: centre the children on it.
    box.y = top;
    const shift = (box.h - band) / 2;
    const move = (m: MindNode) => {
      const b = sized.get(m.id)!;
      b.y += shift;
      if (!m.collapsed) m.children.forEach(move);
    };
    kids.forEach(move);
    return box.h;
  };
  const total = place(root, L.margin);

  const width = Math.ceil(Math.max(...boxes.map((b) => b.x + b.w)) + L.margin);
  const height = Math.ceil(total + L.margin * 2);
  return { boxes, width, height };
}

/** The curve from a parent's right edge to a child's left edge. */
export function edgePath(from: Box, to: Box): string {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const mx = (x1 + x2) / 2;
  const r = (n: number) => Math.round(n * 10) / 10;
  return `M${r(x1)} ${r(y1)} C${r(mx)} ${r(y1)} ${r(mx)} ${r(y2)} ${r(x2)} ${r(y2)}`;
}
