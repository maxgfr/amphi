import { expect, test } from "bun:test";
import { InfographicAnswer, type InfographicData, infographicScene, infographicText, normalizeBlock, WIDTH } from "./infographic-layout.ts";
import { toSvgString } from "./svg.ts";

test("blocks are checked one by one: known types kept, aliases read, broken ones dropped", () => {
  expect(normalizeBlock({ type: "key_figures", items: [{ value: 42, label: "Answer", cite: "S1 p.1" }] })).toEqual({ type: "keyFigures", title: undefined, cite: undefined, items: [{ value: "42", label: "Answer", cite: "S1 p.1" }] });
  expect(normalizeBlock({ type: "glossary", items: [{ term: "Entropy", definition: "Disorder" }] })?.type).toBe("definitions");
  expect(normalizeBlock({ type: "timeline", items: [] })).toBeNull();
  expect(normalizeBlock({ type: "pie", items: [{ value: 1 }] })).toBeNull();
  expect(normalizeBlock(null)).toBeNull();
  expect(normalizeBlock({ type: "steps", items: [{ title: "Heat", text: null }] })).toMatchObject({ items: [{ title: "Heat", text: "" }] });
  const cmp = normalizeBlock({ type: "comparison", columns: ["Gas", "Solid"], rows: [{ label: "Entropy", values: ["high"] }, ["Order", "low", "high", "extra"]] });
  expect(cmp).toMatchObject({ rows: [{ label: "Entropy", values: ["high", ""] }, { label: "Order", values: ["low", "high"] }] });
  const tree = normalizeBlock({ type: "hierarchy", root: { label: "Energy", children: [{ title: "Heat", children: [{ label: "" }, { label: "Conduction" }] }] } });
  expect(tree).toMatchObject({ root: { label: "Energy", children: [{ label: "Heat", children: [{ label: "Conduction", children: [] }] }] } });
});

test("the answer needs a title and at least one usable block", () => {
  expect(InfographicAnswer.safeParse({ title: "T", blocks: [{ type: "pie" }] }).success).toBe(false);
  expect(InfographicAnswer.safeParse({ title: "", blocks: [{ type: "definitions", items: [{ term: "a", definition: "b" }] }] }).success).toBe(false);
  const ok = InfographicAnswer.parse({ title: "T", subtitle: null, blocks: [{ type: "pie" }, { type: "definitions", items: [{ term: "a", definition: "b" }] }] });
  expect(ok.blocks).toHaveLength(1);
  expect(ok.subtitle).toBeUndefined();
});

const data: InfographicData = {
  title: "Thermodynamics <in> one page",
  subtitle: "Entropy & energy",
  blocks: [
    { type: "keyFigures", title: "Figures", items: [{ value: "273.15 K", label: "Zero Celsius", cite: "S1 p.2" }, { value: "2nd", label: "Law" }, { value: "4", label: "Laws" }, { value: "1824", label: "Carnot" }] },
    { type: "timeline", items: [{ date: "1824", label: "Carnot's engine", cite: "S1 p.3" }, { date: "1865", label: "Clausius names entropy" }] },
    { type: "steps", title: "A cycle", cite: "S2 §1", items: [{ title: "Heat", text: "The gas takes heat." }, { title: "Work", text: "" }] },
    { type: "comparison", columns: ["Gas", "Solid"], rows: [{ label: "Entropy", values: ["high", "low"] }] },
    { type: "hierarchy", root: { label: "Energy", children: [{ label: "Heat", children: [] }, { label: "Work", children: [{ label: "<script>", children: [] }] }] } },
    { type: "definitions", items: [{ term: "Entropy", definition: "A measure of disorder that never decreases in an isolated system.", cite: "S1 §1" }] },
  ],
};

test("the scene stays within its width, grows with its blocks, and its citations are buttons", () => {
  const scene = infographicScene(data);
  expect(scene.width).toBe(WIDTH);
  for (const s of scene.shapes) {
    if (s.kind === "rect") expect(s.x + s.w).toBeLessThanOrEqual(WIDTH);
    if (s.kind === "text" && s.anchor !== "end" && s.anchor !== "middle") expect(s.x).toBeLessThan(WIDTH);
    if (s.kind === "text" || s.kind === "rect") expect(Number.isFinite(s.y)).toBe(true);
  }
  const cites = scene.shapes.flatMap((s) => (s.kind === "text" && s.cite ? [s.cite] : []));
  expect(cites).toEqual(["S1 p.2", "S1 p.3", "S2 §1", "S1 §1"]);
  const smaller = infographicScene({ ...data, blocks: data.blocks.slice(0, 1) });
  expect(smaller.height).toBeLessThan(scene.height);
});

test("the SVG file escapes every text, and the text version says the same", () => {
  const svg = toSvgString(infographicScene(data));
  expect(svg).toContain("Thermodynamics &lt;in&gt; one page");
  expect(svg).toContain("&lt;script&gt;");
  expect(svg).not.toContain("<script");
  const text = infographicText(data);
  expect(text).toContain("# Thermodynamics <in> one page");
  expect(text).toContain("- 273.15 K: Zero Celsius [S1 p.2]");
  expect(text).toContain("## A cycle [S2 §1]");
  expect(text).toContain("| Entropy | high | low |");
  expect(text).toContain("    - <script>");
});
