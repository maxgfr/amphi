import { expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { emptySlide, type Slide, SlidesAnswer, slidesMarkdown, toSlide, RawSlide } from "./deck.ts";
import { buildPptx, textBoxes } from "./pptx.ts";
import { type Measure, SLIDE_H, SLIDE_W, slideScene, wrapText } from "./render/slide-layout.ts";
import { toSvgString } from "./render/svg.ts";

/** Every character 10 pixels wide at size 20, whatever the weight. */
const mono: Measure = (s, size) => s.length * size * 0.5;

test("text wraps with the measurer given, cuts words longer than a line and ends a cut text with an ellipsis", () => {
  expect(wrapText("the second law of thermodynamics", 20, 100, mono)).toEqual(["the second", "law of", "thermodyna", "mics"]);
  expect(wrapText("  a   b  ", 20, 100, mono)).toEqual(["a b"]);
  expect(wrapText("", 20, 100, mono)).toEqual([]);
  const cut = wrapText("one two three four five six", 20, 90, mono, 400, 2);
  expect(cut).toHaveLength(2);
  expect(cut[1]!.endsWith("…")).toBe(true);
  for (const line of cut) expect(mono(line, 20, 400)).toBeLessThanOrEqual(90);
  // A wider measurer makes more lines.
  const wide: Measure = (s, size) => s.length * size;
  expect(wrapText("the second law", 20, 100, wide).length).toBeGreaterThan(wrapText("the second law", 20, 100, mono).length);
});

test("slides are read leniently: aliases, labels moved out of the text, layouts fitted to their content", () => {
  const s = toSlide(RawSlide.parse({ layout: "Bullet list", title: "Entropy [S1 p.2]", bullets: ["Measures disorder [S1 p.2]", "", "Never decreases [S2 §3]"], speakerNotes: "Say it slowly." }));
  expect(s).toMatchObject({ layout: "bullets", title: "Entropy", bullets: ["Measures disorder", "Never decreases"], notes: "Say it slowly.", cites: ["S1 p.2", "S2 §3"] });
  expect(toSlide(RawSlide.parse({ layout: "two_columns", title: "Gas and solid", left: { heading: "Gas", bullets: ["High"] }, right: { title: "Solid", bullets: ["Low"] } })).columns).toEqual([
    { heading: "Gas", bullets: ["High"] },
    { heading: "Solid", bullets: ["Low"] },
  ]);
  expect(toSlide(RawSlide.parse({ layout: "quote", title: "Clausius", quote: { text: "Entropy tends to a maximum.", author: "Clausius" } }))).toMatchObject({ layout: "quote", quote: "Entropy tends to a maximum.", author: "Clausius" });
  expect(toSlide(RawSlide.parse({ layout: "keyFigure", title: "Zero", figure: { value: 273.15, label: "kelvins" } })).figure).toEqual({ value: "273.15", label: "kelvins" });
  const d = toSlide(RawSlide.parse({ layout: "cycle", title: "Carnot", diagram: { items: ["Heat", { title: "Expand", text: "It does work" }, null] }, cites: ["S1 p.4", "[S2 §1]"] }));
  expect(d).toMatchObject({ layout: "diagram", diagram: { kind: "cycle", items: [{ label: "Heat" }, { label: "Expand", detail: "It does work" }] }, cites: ["S1 p.4", "S2 §1"] });
  // A diagram with one item, a figure without a value, a quote without words: bullets instead, nothing lost.
  expect(toSlide(RawSlide.parse({ layout: "diagram", title: "T", diagram: { kind: "steps", items: [{ label: "Only", detail: "one" }] } }))).toMatchObject({ layout: "bullets", bullets: ["Only: one"] });
  expect(toSlide(RawSlide.parse({ layout: "key-figure", title: "T", figure: { value: "", label: "Nothing" } }))).toMatchObject({ layout: "bullets", bullets: ["Nothing"] });
  expect(toSlide(RawSlide.parse({ layout: "bullets", title: "Section two" })).layout).toBe("title");
  // No layout: the content decides.
  expect(toSlide(RawSlide.parse({ title: "T", figure: { value: "42", label: "x" } })).layout).toBe("key-figure");
});

test("a deck needs a title and a slide; empty slides are dropped", () => {
  expect(SlidesAnswer.safeParse({ title: "Deck", slides: [] }).success).toBe(false);
  expect(SlidesAnswer.safeParse({ title: "", slides: [{ title: "a", bullets: ["b"] }] }).success).toBe(false);
  const ok = SlidesAnswer.parse({ title: "Deck", slides: [null, { layout: "title" }, { title: "Entropy", bullets: ["Disorder"] }] });
  expect(ok.slides).toHaveLength(1);
  expect(new Set(SlidesAnswer.parse({ title: "D", slides: [{ title: "a" }, { title: "b" }] }).slides.map((s) => s.id)).size).toBe(2);
});

const deck: Slide[] = [
  { ...emptySlide("title"), title: "Thermodynamics <basics>", subtitle: "Entropy & the second law", notes: "Welcome everyone." },
  { ...emptySlide("bullets"), title: "Entropy", bullets: ["Measures disorder", "Never decreases in an isolated system", "Units: joules per kelvin"], notes: "The key idea.", cites: ["S1 p.2"] },
  { ...emptySlide("two-columns"), title: "Gas and solid", columns: [{ heading: "Gas", bullets: ["High entropy"] }, { heading: "Solid", bullets: ["Low entropy", "Ordered"] }] },
  { ...emptySlide("quote"), title: "Clausius", quote: "The entropy of the universe tends to a maximum.", author: "Rudolf Clausius" },
  { ...emptySlide("key-figure"), title: "Absolute zero", figure: { value: "−273.15 °C", label: "Zero kelvin" }, bullets: ["Unreachable"] },
  { ...emptySlide("diagram"), title: "A process", diagram: { kind: "steps", root: "", items: [{ label: "Heat", detail: "Energy comes in", children: [] }, { label: "Work", detail: "Gas expands", children: [] }, { label: "Cool", detail: "", children: [] }] } },
  { ...emptySlide("diagram"), title: "Carnot cycle", diagram: { kind: "cycle", root: "", items: ["Isothermal expansion", "Adiabatic expansion", "Isothermal compression", "Adiabatic compression"].map((label) => ({ label, detail: "", children: [] })) } },
  { ...emptySlide("diagram"), title: "States", diagram: { kind: "comparison", root: "", items: [{ label: "Gas", detail: "", children: ["Free"] }, { label: "Liquid", detail: "", children: ["Flows"] }, { label: "Solid", detail: "", children: ["Fixed"] }] } },
  { ...emptySlide("diagram"), title: "Energy", diagram: { kind: "hierarchy", root: "Energy", items: [{ label: "Heat", detail: "", children: ["Conduction", "Radiation"] }, { label: "Work", detail: "", children: [] }] } },
];

test("every layout stays inside the 16:9 frame and numbers its reveal steps", () => {
  for (const [i, s] of deck.entries()) {
    const scene = slideScene(s, { index: i, total: deck.length });
    expect(scene.width).toBe(SLIDE_W);
    expect(scene.height).toBe(SLIDE_H);
    for (const sh of scene.shapes) {
      if (sh.kind === "rect") {
        expect(sh.x).toBeGreaterThanOrEqual(0);
        expect(sh.x + sh.w).toBeLessThanOrEqual(SLIDE_W + 0.01);
        expect(sh.y + sh.h).toBeLessThanOrEqual(SLIDE_H + 0.01);
      }
      if (sh.kind === "text") {
        expect(sh.y).toBeGreaterThan(0);
        expect(sh.y).toBeLessThan(SLIDE_H);
        if (sh.box && !sh.deco) {
          expect(sh.box.x).toBeGreaterThanOrEqual(0);
          expect(sh.box.x + sh.box.w).toBeLessThanOrEqual(SLIDE_W + 0.01);
        }
      }
    }
    const steps = scene.shapes.map((x) => x.step ?? 0);
    expect(Math.max(...steps)).toBe(scene.steps);
  }
  // Bullets come one step each; the title is always shown.
  const bullets = slideScene(deck[1]!);
  expect(bullets.steps).toBe(3);
  expect(bullets.shapes.find((x) => x.kind === "text" && x.heading)?.step).toBeUndefined();
  // The page number is drawn but marked for the page only; the video leaves it out.
  expect(bullets.shapes.some((x) => x.kind === "text" && x.text === "1 / 1")).toBe(false);
  expect(slideScene(deck[1]!, { index: 1, total: 9 }).shapes.some((x) => x.kind === "text" && x.text === "2 / 9" && x.deco)).toBe(true);
  expect(slideScene(deck[1]!, { index: 1, total: 9, number: false }).shapes.some((x) => x.kind === "text" && x.text === "2 / 9")).toBe(false);
  // The model's text is escaped in a file.
  expect(toSvgString(slideScene(deck[0]!))).toContain("Thermodynamics &lt;basics&gt;");
});

test("lines go back into paragraphs, and a list's bullets share one text box", () => {
  const scene = slideScene({ ...deck[1]!, bullets: ["A long bullet that has to wrap over two lines at least on this slide because it keeps going and going", "Short"] });
  const boxes = textBoxes(scene.shapes);
  const list = boxes.find((b) => b.paras[0]!.shapes[0]!.bullet);
  expect(list?.paras).toHaveLength(2);
  expect(list!.paras[0]!.shapes.length).toBeGreaterThan(1);
});

test("a PPTX holds every slide with its title placeholder, text, bullets, shapes and notes", async () => {
  const bytes = await buildPptx("Thermo & co", deck, { language: "fr" });
  expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  const zip = unzipSync(bytes);
  const slides = Object.keys(zip).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  expect(slides).toHaveLength(deck.length);
  const xml = (n: string) => strFromU8(zip[n]!);
  const pres = xml("ppt/presentation.xml");
  expect(pres.match(/<p:sldId /g)).toHaveLength(deck.length);
  // 16:9 at 13.333 × 7.5 inches.
  expect(pres).toContain('<p:sldSz cx="12192000" cy="6858000"');
  expect(xml("docProps/core.xml")).toContain("<dc:title>Thermo &amp; co</dc:title>");

  const s1 = xml("ppt/slides/slide1.xml");
  expect(s1).toContain('type="title"');
  expect(s1).toContain("Thermodynamics &lt;basics&gt;");
  expect(s1).toContain("Entropy &amp; the second law");
  expect(s1).toContain('lang="fr-FR"');

  const s2 = xml("ppt/slides/slide2.xml");
  expect(s2).toContain("<a:t>Entropy</a:t>");
  expect(s2).toContain("Never decreases in an isolated system");
  expect(s2.match(/<a:buChar /g)?.length).toBe(3);
  expect(s2).toContain("S1 p.2");
  // Explicit colours, no theme colours.
  expect(s2).toContain('<a:srgbClr val="23262D"');
  expect(s2).not.toContain("<a:schemeClr");

  // Diagrams are shapes: rounded boxes, arrows.
  const s6 = xml("ppt/slides/slide6.xml");
  expect(s6.match(/prst="roundRect"/g)?.length).toBeGreaterThanOrEqual(3);
  expect(s6).toContain('<a:tailEnd type="triangle"');
  expect(s6).toContain("Energy comes in");
  expect(xml("ppt/slides/slide9.xml")).toContain("Conduction");

  // Notes go with their slide.
  const notes = Object.keys(zip).filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
  expect(notes.length).toBe(deck.length);
  expect(xml("ppt/notesSlides/notesSlide1.xml")).toContain("Welcome everyone.");
  expect(xml("ppt/notesSlides/notesSlide2.xml")).toContain("The key idea.");
});

test("the deck as Markdown keeps every slide, its citations and its notes", () => {
  const md = slidesMarkdown("Thermo", deck);
  expect(md).toStartWith("# Thermo\n\n## 1. Thermodynamics <basics>");
  expect(md).toContain("- Never decreases in an isolated system");
  expect(md).toContain("[S1 p.2]");
  expect(md).toContain("*The key idea.*");
  expect(md).toContain("> The entropy of the universe tends to a maximum. (Rudolf Clausius)");
  expect(md).toContain("- Heat\n  - Conduction\n  - Radiation");
});
