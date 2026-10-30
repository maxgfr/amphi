// A deck as a PowerPoint file, built with pptxgenjs from the same scenes the
// page draws: the title goes in the slide's title placeholder (what readers
// such as Cursus take as the slide's title), every paragraph is a real text
// box (bullets as bullet paragraphs, so the text stays editable), diagrams
// are native shapes, the notes are the speaker notes, and every colour is
// explicit (the light palette), whatever the theme of the program opening it.

import type { Slide } from "./deck.ts";
import { type Measure, SLIDE_H, SLIDE_W, type SlideShape, slideScene } from "./render/slide-layout.ts";
import { PALETTE, type Role } from "./render/svg.ts";

const PX = 96;
const inch = (px: number) => Math.round((px / PX) * 1000) / 1000;
const pt = (px: number) => Math.round(px * 0.75 * 10) / 10;
const hex = (r: Role) => PALETTE[r].replace("#", "").toUpperCase();
const FACE = "Arial";
const LH = 1.25;

type TextShape = Extract<SlideShape, { kind: "text" }>;

interface Para {
  shapes: TextShape[];
  top: number;
  bottom: number;
}

/** Lines grouped back into paragraphs, and paragraphs into text boxes: bullets of one list share a box. */
export function textBoxes(shapes: SlideShape[]): { at: number; paras: Para[] }[] {
  const paras = new Map<number, { at: number; para: Para }>();
  shapes.forEach((s, i) => {
    if (s.kind !== "text" || s.deco || s.para === undefined) return;
    const half = (s.size * LH) / 2;
    const p = paras.get(s.para);
    if (p) {
      p.para.shapes.push(s);
      p.para.bottom = s.y + half;
    } else paras.set(s.para, { at: i, para: { shapes: [s], top: s.y - half, bottom: s.y + half } });
  });
  const boxes: { at: number; paras: Para[] }[] = [];
  for (const { at, para } of paras.values()) {
    const first = para.shapes[0]!;
    const prev = boxes.at(-1)?.paras.at(-1)?.shapes[0];
    const joins =
      prev && ((first.bullet && prev.bullet && prev.box?.x === first.box?.x && prev.box?.w === first.box?.w && prev.size === first.size && prev.fill === first.fill) || (first.cite && prev.cite));
    if (joins) boxes.at(-1)!.paras.push(para);
    else boxes.push({ at, paras: [para] });
  }
  return boxes;
}

const MASTER = "AMPHI";
const COVER = "AMPHI_COVER";

/** The deck as a .pptx file's bytes. */
export async function buildPptx(title: string, slides: Slide[], o: { language?: string; measure?: Measure } = {}): Promise<Uint8Array> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  // 13.333 × 7.5 inches: the slide's 1280 × 720 at 96 pixels an inch.
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = title;
  pptx.subject = title;
  pptx.company = "amphi";
  pptx.theme = { headFontFace: FACE, bodyFontFace: FACE };
  const lang = o.language ? ({ fr: "fr-FR", de: "de-DE", en: "en-US" } as Record<string, string>)[o.language] ?? o.language : undefined;
  const titleText = { fontFace: FACE, bold: true, color: hex("text"), margin: 0, valign: "top" as const, fit: "none" as const };
  const number = { x: inch(SLIDE_W - 72 - 160), y: inch(SLIDE_H - 54), w: inch(160), h: inch(18 * LH), fontFace: FACE, fontSize: pt(18), color: hex("muted"), align: "right" as const };
  pptx.defineSlideMaster({
    title: MASTER,
    background: { color: hex("surface") },
    slideNumber: number,
    objects: [{ placeholder: { options: { name: "title", type: "title", x: inch(72), y: inch(52), w: inch(SLIDE_W - 144), h: inch(2 * 44 * LH), fontSize: pt(44), ...titleText, align: "left" }, text: "" } }],
  });
  const mid = SLIDE_H * 0.52;
  pptx.defineSlideMaster({
    title: COVER,
    background: { color: hex("surface") },
    objects: [{ placeholder: { options: { name: "title", type: "title", x: inch(120), y: inch(mid - 3 * 64 * LH), w: inch(SLIDE_W - 240), h: inch(3 * 64 * LH), fontSize: pt(64), ...titleText, align: "center", valign: "bottom" }, text: "" } }],
  });

  slides.forEach((slide, index) => {
    const scene = slideScene(slide, { index, total: slides.length, measure: o.measure });
    const s = pptx.addSlide({ masterName: slide.layout === "title" ? COVER : MASTER });
    const boxes = new Map(textBoxes(scene.shapes).map((b) => [b.at, b.paras]));
    scene.shapes.forEach((sh, i) => {
      const paras = boxes.get(i);
      if (paras) return addText(s, paras, lang);
      if (sh.deco) return;
      switch (sh.kind) {
        case "rect": {
          const line = sh.stroke && (sh.strokeWidth ?? 1) > 0 ? { color: hex(sh.stroke), width: pt(sh.strokeWidth ?? 1) } : { type: "none" as const };
          const geo = { x: inch(sh.x), y: inch(sh.y), w: inch(sh.w), h: inch(sh.h), fill: sh.fill ? { color: hex(sh.fill) } : { type: "none" as const }, line };
          if (sh.r) s.addShape(pptx.ShapeType.roundRect, { ...geo, rectRadius: inch(sh.r) });
          else s.addShape(pptx.ShapeType.rect, geo);
          return;
        }
        case "circle":
          s.addShape(pptx.ShapeType.ellipse, {
            x: inch(sh.cx - sh.r),
            y: inch(sh.cy - sh.r),
            w: inch(sh.r * 2),
            h: inch(sh.r * 2),
            fill: sh.fill ? { color: hex(sh.fill) } : { type: "none" },
            line: sh.stroke ? { color: hex(sh.stroke), width: pt(sh.strokeWidth ?? 1) } : { type: "none" },
          });
          return;
        case "line": {
          // A line is a box from one corner to the other, flipped when it goes up or left.
          const x = Math.min(sh.x1, sh.x2);
          const y = Math.min(sh.y1, sh.y2);
          s.addShape(pptx.ShapeType.line, {
            x: inch(x),
            y: inch(y),
            w: inch(Math.abs(sh.x2 - sh.x1)),
            h: inch(Math.abs(sh.y2 - sh.y1)),
            flipH: sh.x2 < sh.x1,
            flipV: sh.y2 < sh.y1,
            line: { color: hex(sh.stroke), width: pt(sh.strokeWidth ?? 1), ...(sh.arrow ? { endArrowType: "triangle" as const } : {}) },
          });
          return;
        }
        default:
          return;
      }
    });
    if (slide.notes.trim()) s.addNotes(slide.notes.trim());
  });
  return (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
}

type PptxSlide = ReturnType<InstanceType<typeof import("pptxgenjs").default>["addSlide"]>;

function addText(s: PptxSlide, paras: Para[], lang?: string) {
  const first = paras[0]!.shapes[0]!;
  const align = first.anchor === "middle" ? ("center" as const) : first.anchor === "end" ? ("right" as const) : ("left" as const);
  const style = (t: TextShape) => ({ fontFace: FACE, fontSize: pt(t.size), bold: (t.weight ?? 400) >= 600, color: hex(t.fill), ...(lang ? { lang } : {}) });
  if (first.heading) {
    s.addText(paras.map((p) => p.shapes.map((l) => l.text).join(" ")).join(" "), { placeholder: "title", ...style(first), align });
    return;
  }
  const indent = first.bullet ? 36 : 0;
  const box = first.box ?? { x: first.x, w: 200 };
  const top = paras[0]!.top;
  const bottom = paras.at(-1)!.bottom;
  const sep = first.cite ? " · " : " ";
  const runs = paras.map((p, i) => ({
    text: p.shapes.map((l) => l.text).join(" "),
    options: {
      ...style(p.shapes[0]!),
      breakLine: i < paras.length - 1,
      ...(first.bullet ? { bullet: { indent: pt(indent) } } : {}),
      ...(i > 0 ? { paraSpaceBefore: pt(Math.max(0, p.top - paras[i - 1]!.bottom)) } : {}),
    },
  }));
  const content = first.cite ? [{ text: paras.map((p) => p.shapes[0]!.text).join(sep), options: style(first) }] : runs;
  s.addText(content, {
    x: inch(box.x - indent),
    y: inch(top),
    // A little room: the program opening it may set the text slightly wider than it was measured.
    w: inch(first.cite ? Math.min(SLIDE_W / 2, box.w * paras.length + 40) : box.w + indent + 8),
    h: inch(bottom - top),
    margin: 0,
    valign: "top",
    align,
    lineSpacing: pt(first.size * LH),
    fit: "none",
    wrap: true,
  });
}
