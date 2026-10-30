// The mind map as data: the tree the model answers with (validated by zod),
// made into nodes with ids, and the edits the editor makes on it. Every edit
// returns a new tree, so React and the undo-free save stay simple.

import { z } from "zod";
import { citationsIn } from "../../ai/context.ts";

export interface MindNode {
  id: string;
  title: string;
  note?: string;
  /** One citation label ("S1 p.3"). */
  cite?: string;
  collapsed?: boolean;
  children: MindNode[];
}

export interface MindmapData {
  root: MindNode;
}

/** Levels, the central topic included. */
export const MAX_DEPTH = 4;

export interface RawNode {
  title: string;
  note?: string | null;
  cite?: string | null;
  children?: RawNode[] | null;
}

export const RawNodeSchema: z.ZodType<RawNode> = z.lazy(() =>
  z.object({
    title: z.string().trim().min(1),
    note: z.string().nullish(),
    cite: z.string().nullish(),
    children: z.array(RawNodeSchema).nullish(),
  }),
);

/** The model's answer: a tree, possibly wrapped in { root } or { mindmap }. */
export const MindmapAnswer = z.union([RawNodeSchema, z.object({ root: RawNodeSchema }).transform((o) => o.root), z.object({ mindmap: RawNodeSchema }).transform((o) => o.mindmap)]);

export const SHAPE = `{ "title": string, "note"?: string, "cite"?: string, "children": [ { "title": string, "note"?: string, "cite"?: string, "children": [ … ] } ] }`;

let seq = 0;
export const newNodeId = () => `n${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A label the interface can open ("S1 p.3"), from "[S1 p.3]", "S1 p.3" or "(S1 p.3)". */
export function citeLabel(cite: string | null | undefined): string | undefined {
  if (!cite) return undefined;
  const inner = cite.replace(/^[[(\s]+|[\])\s]+$/g, "");
  return citationsIn(`[${inner}]`)[0] ?? citationsIn(cite)[0];
}

/** Nodes with ids, titles trimmed, levels past MAX_DEPTH dropped. */
export function fromRaw(raw: RawNode, depth = 1): MindNode {
  const note = raw.note?.trim();
  return {
    id: newNodeId(),
    title: raw.title.trim().replace(/\s+/g, " "),
    note: note || undefined,
    cite: citeLabel(raw.cite),
    children: depth >= MAX_DEPTH ? [] : (raw.children ?? []).map((c) => fromRaw(c, depth + 1)),
  };
}

export interface Found {
  node: MindNode;
  parent?: MindNode;
  index: number;
  depth: number;
}

export function find(root: MindNode, id: string): Found | undefined {
  const walk = (node: MindNode, parent: MindNode | undefined, index: number, depth: number): Found | undefined => {
    if (node.id === id) return { node, parent, index, depth };
    for (let i = 0; i < node.children.length; i++) {
      const hit = walk(node.children[i]!, node, i, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(root, undefined, 0, 0);
}

/** The tree with one node replaced by `fn(node)`. */
export function mapNode(root: MindNode, id: string, fn: (n: MindNode) => MindNode): MindNode {
  if (root.id === id) return fn(root);
  let changed = false;
  const children = root.children.map((c) => {
    const next = mapNode(c, id, fn);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...root, children } : root;
}

export const rename = (root: MindNode, id: string, title: string) => {
  const v = title.trim().replace(/\s+/g, " ");
  return v ? mapNode(root, id, (n) => ({ ...n, title: v })) : root;
};

export const toggle = (root: MindNode, id: string, collapsed?: boolean) => mapNode(root, id, (n) => (n.children.length ? { ...n, collapsed: collapsed ?? !n.collapsed } : n));

export function addChild(root: MindNode, id: string, child: MindNode): MindNode {
  return mapNode(root, id, (n) => ({ ...n, collapsed: false, children: [...n.children, child] }));
}

/** A sibling right after the node (a child for the central topic). */
export function addSibling(root: MindNode, id: string, sibling: MindNode): MindNode {
  const f = find(root, id);
  if (!f?.parent) return addChild(root, id, sibling);
  const parent = f.parent;
  return mapNode(root, parent.id, (p) => ({ ...p, children: [...p.children.slice(0, f.index + 1), sibling, ...p.children.slice(f.index + 1)] }));
}

/** Without the node and its branch (the central topic stays). */
export function removeNode(root: MindNode, id: string): MindNode {
  const f = find(root, id);
  if (!f?.parent) return root;
  return mapNode(root, f.parent.id, (p) => ({ ...p, children: p.children.filter((c) => c.id !== id) }));
}

/** Up (-1) or down (+1) among its siblings. */
export function moveAmongSiblings(root: MindNode, id: string, delta: -1 | 1): MindNode {
  const f = find(root, id);
  if (!f?.parent) return root;
  const to = f.index + delta;
  if (to < 0 || to >= f.parent.children.length) return root;
  return mapNode(root, f.parent.id, (p) => {
    const children = [...p.children];
    [children[f.index], children[to]] = [children[to]!, children[f.index]!];
    return { ...p, children };
  });
}

/** One level up: right after its parent, among the parent's siblings. */
export function outdent(root: MindNode, id: string): MindNode {
  const f = find(root, id);
  if (!f?.parent) return root;
  const p = find(root, f.parent.id)!;
  if (!p.parent) return root;
  const without = removeNode(root, id);
  return mapNode(without, p.parent.id, (g) => ({ ...g, children: [...g.children.slice(0, p.index + 1), f.node, ...g.children.slice(p.index + 1)] }));
}

/** One level down: the last child of its previous sibling. */
export function indent(root: MindNode, id: string): MindNode {
  const f = find(root, id);
  if (!f?.parent || f.index === 0) return root;
  const prev = f.parent.children[f.index - 1]!;
  const without = removeNode(root, id);
  return mapNode(without, prev.id, (n) => ({ ...n, collapsed: false, children: [...n.children, f.node] }));
}

export const countNodes = (n: MindNode): number => 1 + n.children.reduce((s, c) => s + countNodes(c), 0);

/** The nodes in reading order, collapsed branches skipped. */
export function visible(root: MindNode): MindNode[] {
  const out: MindNode[] = [];
  const walk = (n: MindNode) => {
    out.push(n);
    if (!n.collapsed) n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** Where the arrow keys lead from a node. */
export function neighbour(root: MindNode, id: string, key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): string | undefined {
  const f = find(root, id);
  if (!f) return undefined;
  if (key === "ArrowLeft") return f.parent?.id;
  if (key === "ArrowRight") return !f.node.collapsed ? f.node.children[0]?.id : undefined;
  if (!f.parent) return undefined;
  const sib = f.parent.children[f.index + (key === "ArrowUp" ? -1 : 1)];
  return sib?.id;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** A Markdown outline: the central topic as the heading, branches as nested lists. */
export function toOutline(root: MindNode): string {
  const lines = [`# ${oneLine(root.title)}`, ""];
  if (root.note) lines.push(oneLine(root.note), "");
  const walk = (n: MindNode, depth: number) => {
    const extra = [n.note ? `: ${oneLine(n.note)}` : "", n.cite ? ` [${n.cite}]` : ""].join("");
    lines.push(`${"  ".repeat(depth)}- ${oneLine(n.title)}${extra}`);
    for (const c of n.children) walk(c, depth + 1);
  };
  for (const c of root.children) walk(c, 0);
  return `${lines.join("\n")}\n`;
}
