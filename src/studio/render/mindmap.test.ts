import { expect, test } from "bun:test";
import { type Box, layoutTree } from "./mindmap-layout.ts";
import { mindmapScene } from "./mindmap-svg.ts";
import {
  addChild,
  addSibling,
  citeLabel,
  countNodes,
  find,
  fromRaw,
  indent,
  MAX_DEPTH,
  MindmapAnswer,
  type MindNode,
  moveAmongSiblings,
  neighbour,
  outdent,
  type RawNode,
  removeNode,
  rename,
  toggle,
  toOutline,
  visible,
} from "./mindmap-tree.ts";
import { toSvgString } from "./svg.ts";

const n = (id: string, title: string, children: MindNode[] = [], extra: Partial<MindNode> = {}): MindNode => ({ id, title, children, ...extra });
const sample = () =>
  n("r", "Thermodynamics", [
    n("a", "Entropy", [n("a1", "Disorder"), n("a2", "Second law", [], { cite: "S1 §1", note: "Never decreases" })]),
    n("b", "Energy", [n("b1", "Conservation")]),
    n("c", "Temperature"),
  ]);

test("the model's tree is accepted bare or wrapped, and made into nodes", () => {
  const raw = { title: "T", children: [{ title: " A ", cite: "[S1 p.3]", note: null, children: [{ title: "A1" }] }, { title: "B", children: null }] };
  expect(MindmapAnswer.safeParse(raw).success).toBe(true);
  expect(MindmapAnswer.safeParse({ root: raw }).success).toBe(true);
  expect(MindmapAnswer.safeParse({ mindmap: raw }).success).toBe(true);
  expect(MindmapAnswer.safeParse({ title: "" }).success).toBe(false);
  expect(MindmapAnswer.safeParse({ title: "T", children: [{ note: "no title" }] }).success).toBe(false);
  const root = fromRaw(MindmapAnswer.parse(raw));
  expect(root.children[0]!.title).toBe("A");
  expect(root.children[0]!.cite).toBe("S1 p.3");
  expect(root.children[0]!.note).toBeUndefined();
  expect(root.children[1]!.children).toEqual([]);
  const ids = visible(root).map((x) => x.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("levels past the limit are dropped", () => {
  let raw: RawNode = { title: "leaf" };
  for (let i = 0; i < 8; i++) raw = { title: `level ${i}`, children: [raw] };
  const root = fromRaw(raw);
  let depth = 0;
  for (let cur: MindNode | undefined = root; cur; cur = cur.children[0]) depth++;
  expect(depth).toBe(MAX_DEPTH);
});

test("citation labels are read from what models write", () => {
  expect(citeLabel("S2 12:34")).toBe("S2 12:34");
  expect(citeLabel("[S1 §2]")).toBe("S1 §2");
  expect(citeLabel("(S3 p.10)")).toBe("S3 p.10");
  expect(citeLabel("page 3")).toBeUndefined();
  expect(citeLabel(null)).toBeUndefined();
});

test("edits: rename, add, delete, move, collapse", () => {
  const root = sample();
  expect(find(rename(root, "a1", "  Chaos  "), "a1")!.node.title).toBe("Chaos");
  expect(rename(root, "a1", "   ")).toBe(root);
  const withChild = addChild(toggle(root, "a"), "a", n("x", "New"));
  expect(find(withChild, "a")!.node.collapsed).toBe(false);
  expect(find(withChild, "a")!.node.children.at(-1)!.id).toBe("x");
  expect(find(addSibling(root, "a", n("y", "Y")), "y")!.index).toBe(1);
  expect(find(addSibling(root, "r", n("z", "Z")), "z")!.parent!.id).toBe("r");
  expect(find(removeNode(root, "a"), "a2")).toBeUndefined();
  expect(removeNode(root, "r")).toBe(root);
  expect(moveAmongSiblings(root, "b", -1).children.map((c) => c.id)).toEqual(["b", "a", "c"]);
  expect(moveAmongSiblings(root, "a", -1)).toBe(root);
  const out = outdent(root, "a2");
  expect(out.children.map((c) => c.id)).toEqual(["a", "a2", "b", "c"]);
  expect(outdent(root, "a")).toBe(root);
  const ind = indent(root, "b");
  expect(find(ind, "b")!.parent!.id).toBe("a");
  expect(indent(root, "a")).toBe(root);
  expect(countNodes(root)).toBe(countNodes(outdent(root, "a2")));
  // The original is untouched.
  expect(root.children.map((c) => c.id)).toEqual(["a", "b", "c"]);
});

test("arrow keys follow the tree", () => {
  const root = sample();
  expect(neighbour(root, "r", "ArrowRight")).toBe("a");
  expect(neighbour(root, "a", "ArrowDown")).toBe("b");
  expect(neighbour(root, "b", "ArrowUp")).toBe("a");
  expect(neighbour(root, "a2", "ArrowLeft")).toBe("a");
  expect(neighbour(root, "c", "ArrowDown")).toBeUndefined();
  expect(neighbour(toggle(root, "a"), "a", "ArrowRight")).toBeUndefined();
});

const overlap = (p: Box, q: Box) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;

test("the layout is a horizontal tree: levels in columns, parents centred, nothing overlapping", () => {
  const big = n(
    "r",
    "A central topic with a rather long title that wraps",
    Array.from({ length: 5 }, (_, i) => n(`c${i}`, `Branch ${i}`, Array.from({ length: i + 1 }, (_, j) => n(`c${i}-${j}`, `Idea ${i}.${j} with a few words`, j === 0 ? [n(`c${i}-${j}-x`, "Detail")] : [])))),
  );
  const { boxes, width, height } = layoutTree(big);
  expect(boxes).toHaveLength(countNodes(big));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!, boxes[j]!)).toBe(false);
  const byId = new Map(boxes.map((b) => [b.id, b]));
  for (const b of boxes) {
    expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= width && b.y + b.h <= height).toBe(true);
    if (!b.parentId) continue;
    const p = byId.get(b.parentId)!;
    expect(b.x).toBeGreaterThan(p.x + p.w);
    expect(b.branch).toBe(p.depth === 0 ? Number(b.id.slice(1, 2)) : p.branch);
  }
  // The same depth, the same column.
  const xs = new Map<number, Set<number>>();
  for (const b of boxes) xs.set(b.depth, (xs.get(b.depth) ?? new Set()).add(b.x));
  for (const s of xs.values()) expect(s.size).toBe(1);
  // A parent is centred on its first and last child.
  const c4 = byId.get("c4")!;
  const first = byId.get("c4-0")!;
  const last = byId.get("c4-4")!;
  expect(Math.abs(c4.y + c4.h / 2 - (first.y + first.h / 2 + last.y + last.h / 2) / 2)).toBeLessThan(0.01);
});

test("a collapsed branch is hidden and counted", () => {
  const { boxes } = layoutTree(toggle(sample(), "a"));
  expect(boxes.map((b) => b.id)).toEqual(["r", "a", "b", "b1", "c"]);
  expect(boxes.find((b) => b.id === "a")!.hidden).toBe(2);
});

test("the outline and the SVG carry the tree, escaped", () => {
  const root = sample();
  root.children.push(n("e", "<b>Heat</b> & work"));
  const md = toOutline(root);
  expect(md).toBe("# Thermodynamics\n\n- Entropy\n  - Disorder\n  - Second law: Never decreases [S1 §1]\n- Energy\n  - Conservation\n- Temperature\n- <b>Heat</b> & work\n");
  const svg = toSvgString(mindmapScene(layoutTree(root), root));
  expect(svg).toContain("&lt;b&gt;Heat&lt;/b&gt; &amp; work");
  expect(svg).not.toContain("<b>");
  expect((svg.match(/<path /g) ?? []).length).toBe(countNodes(root) - 1);
});
