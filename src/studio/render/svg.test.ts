import { expect, test } from "bun:test";
import { escapeXml, PALETTE, ROLES, type Scene, textWidth, toSvgString, wrap } from "./svg.ts";

test("text is escaped for XML, and characters XML cannot hold are dropped", () => {
  expect(escapeXml(`<script>alert("x") & 'y'</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot;) &amp; &apos;y&apos;&lt;/script&gt;");
  expect(escapeXml("a\u0000b\u0007c￿d")).toBe("abcd");
  expect(escapeXml("é ü 中 😀")).toBe("é ü 中 😀");
});

test("a scene becomes a standalone SVG with explicit colours and no markup from its text", () => {
  const scene: Scene = {
    width: 200,
    height: 100,
    title: 'Map <of> "ideas"',
    shapes: [
      { kind: "rect", x: 1, y: 2, w: 3, h: 4, fill: "accent", stroke: "line" },
      { kind: "text", x: 10, y: 20, text: "</text><script>evil()</script>", size: 14, fill: "text", cite: "S1 p.3" },
      { kind: "path", d: "M0 0 C1 1 2 2 3 3", stroke: "b2" },
    ],
  };
  const svg = toSvgString(scene);
  expect(svg.startsWith("<?xml")).toBe(true);
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain("<title id=\"t\">Map &lt;of&gt; &quot;ideas&quot;</title>");
  expect(svg).toContain("&lt;/text&gt;&lt;script&gt;evil()&lt;/script&gt;");
  expect(svg).not.toContain("<script");
  expect(svg).not.toContain("style=");
  expect(svg).not.toContain("var(--");
  expect(svg).toContain(`fill="${PALETTE.accent}"`);
  expect(svg).toContain(`stroke="${PALETTE.b2}"`);
  // Every element is closed.
  expect((svg.match(/<text /g) ?? []).length).toBe((svg.match(/<\/text>/g) ?? []).length);
});

test("every role has an explicit colour", () => {
  for (const r of ROLES) expect(PALETTE[r]).toMatch(/^#[0-9a-f]{6}$/);
});

test("wrapping keeps lines within the width and cuts words too long for one", () => {
  const lines = wrap("The second law of thermodynamics says that entropy never decreases", 14, 120);
  expect(lines.length).toBeGreaterThan(1);
  for (const l of lines) expect(textWidth(l, 14)).toBeLessThanOrEqual(120);
  const long = wrap("Pneumonoultramicroscopicsilicovolcanoconiosis", 14, 80);
  expect(long.join("")).toBe("Pneumonoultramicroscopicsilicovolcanoconiosis");
  for (const l of long) expect(textWidth(l, 14)).toBeLessThanOrEqual(80);
  const capped = wrap("one two three four five six seven eight nine ten eleven twelve", 14, 60, 400, 2);
  expect(capped).toHaveLength(2);
  expect(capped[1]!.endsWith("…")).toBe(true);
  expect(wrap("", 14, 100)).toEqual([""]);
});
