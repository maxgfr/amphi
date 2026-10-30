// A tiny scene of shapes shared by the mind map and the infographic: laid out
// once, drawn by React in the page (colours from the theme's custom
// properties) and serialized to a standalone SVG file (explicit colours, every
// text escaped). The model only ever provides text: it never reaches the DOM
// as markup.

/** What a shape is coloured as; the page maps roles to CSS classes, files to the palette below. */
export const ROLES = ["bg", "surface", "surface2", "line", "text", "muted", "accent", "accentInk", "accentSoft", "b0", "b1", "b2", "b3", "b4", "b5", "b0soft", "b1soft", "b2soft", "b3soft", "b4soft", "b5soft"] as const;
export type Role = (typeof ROLES)[number];

/** A branch's colour (one hue per first-level branch, in a fixed order). */
export const branch = (i: number): Role => `b${((i % 6) + 6) % 6}` as Role;
export const branchSoft = (i: number): Role => `b${((i % 6) + 6) % 6}soft` as Role;

/** The light theme in plain hex, for files opened outside the app. */
export const PALETTE: Record<Role, string> = {
  bg: "#f9f8f5",
  surface: "#ffffff",
  surface2: "#f1f0ec",
  line: "#dcdad4",
  text: "#23262d",
  muted: "#5f636c",
  accent: "#2f63b8",
  accentInk: "#ffffff",
  accentSoft: "#e4ecfa",
  b0: "#2a78d6",
  b1: "#eb6834",
  b2: "#1baf7a",
  b3: "#eda100",
  b4: "#e87ba4",
  b5: "#008300",
  b0soft: "#e3eefb",
  b1soft: "#fde9e0",
  b2soft: "#dff5ec",
  b3soft: "#fdf1d6",
  b4soft: "#fbe9f0",
  b5soft: "#dcf0dc",
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

export type Shape =
  | { kind: "rect"; x: number; y: number; w: number; h: number; r?: number; fill?: Role; stroke?: Role; strokeWidth?: number }
  | { kind: "circle"; cx: number; cy: number; r: number; fill?: Role; stroke?: Role; strokeWidth?: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: Role; strokeWidth?: number; dash?: boolean }
  | { kind: "path"; d: string; stroke?: Role; fill?: Role; strokeWidth?: number }
  | {
      kind: "text";
      x: number;
      y: number;
      text: string;
      size: number;
      fill: Role;
      weight?: number;
      anchor?: "start" | "middle" | "end";
      /** A citation label: a button in the page, plain text in a file. */
      cite?: string;
    };

export interface Scene {
  width: number;
  height: number;
  /** The accessible name, and the file's <title>. */
  title: string;
  /** A longer text alternative (the file's <desc>). */
  desc?: string;
  background?: Role;
  shapes: Shape[];
}

/** Text as XML character data or attribute value; drops characters XML cannot hold. */
export function escapeXml(s: string): string {
  return s
    .replace(/[^\t\n\r\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const num = (n: number) => String(Math.round(n * 100) / 100);

/** A standalone SVG document with explicit colours and presentation attributes only (no style, no script). */
export function toSvgString(scene: Scene, palette: Record<Role, string> = PALETTE): string {
  const c = (r?: Role) => (r ? palette[r] : "none");
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(scene.width)}" height="${num(scene.height)}" viewBox="0 0 ${num(scene.width)} ${num(scene.height)}" role="img" aria-labelledby="t d" font-family="${escapeXml(FONT)}">`,
  );
  out.push(`<title id="t">${escapeXml(scene.title)}</title>`);
  out.push(`<desc id="d">${escapeXml(scene.desc ?? scene.title)}</desc>`);
  out.push(`<rect x="0" y="0" width="${num(scene.width)}" height="${num(scene.height)}" fill="${c(scene.background ?? "bg")}"/>`);
  for (const s of scene.shapes) {
    switch (s.kind) {
      case "rect":
        out.push(`<rect x="${num(s.x)}" y="${num(s.y)}" width="${num(s.w)}" height="${num(s.h)}" rx="${num(s.r ?? 0)}" fill="${c(s.fill)}" stroke="${c(s.stroke)}" stroke-width="${num(s.strokeWidth ?? 1)}"/>`);
        break;
      case "circle":
        out.push(`<circle cx="${num(s.cx)}" cy="${num(s.cy)}" r="${num(s.r)}" fill="${c(s.fill)}" stroke="${c(s.stroke)}" stroke-width="${num(s.strokeWidth ?? 1)}"/>`);
        break;
      case "line":
        out.push(`<line x1="${num(s.x1)}" y1="${num(s.y1)}" x2="${num(s.x2)}" y2="${num(s.y2)}" stroke="${c(s.stroke)}" stroke-width="${num(s.strokeWidth ?? 1)}"${s.dash ? ' stroke-dasharray="4 4"' : ""}/>`);
        break;
      case "path":
        out.push(`<path d="${escapeXml(s.d)}" fill="${c(s.fill)}" stroke="${c(s.stroke)}" stroke-width="${num(s.strokeWidth ?? 1)}" stroke-linecap="round"/>`);
        break;
      case "text":
        out.push(
          `<text x="${num(s.x)}" y="${num(s.y)}" font-size="${num(s.size)}" font-weight="${s.weight ?? 400}" fill="${c(s.fill)}" text-anchor="${s.anchor ?? "start"}" dominant-baseline="middle">${escapeXml(s.text)}</text>`,
        );
        break;
    }
  }
  out.push(`</svg>`);
  return `${out.join("\n")}\n`;
}

export const svgBlob = (scene: Scene) => new Blob([toSvgString(scene)], { type: "image/svg+xml" });

/** The scene as a PNG: the SVG file drawn on a canvas through an <img> of a blob URL (CSP: img-src blob:). */
export async function pngBlob(scene: Scene, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(svgBlob(scene));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The image could not be drawn."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    // Browsers cap canvas sizes: keep the long side under 16k pixels.
    const k = Math.min(scale, 16_000 / Math.max(scene.width, scene.height));
    canvas.width = Math.max(1, Math.round(scene.width * k));
    canvas.height = Math.max(1, Math.round(scene.height * k));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The image could not be made."))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Text measuring: a canvas in the browser, a per-character estimate elsewhere
// (tests), so a layout never depends on fonts being loaded to be sane.
let measurer: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

function estimate(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    if (/[ilI.,:;'!|\s]/.test(ch)) w += 0.3;
    else if (/[mwMW@]/.test(ch)) w += 0.85;
    else if (/[A-Z0-9]/.test(ch)) w += 0.65;
    else if (ch.codePointAt(0)! > 0x2e80) w += 1;
    else w += 0.55;
  }
  return w * size;
}

export function textWidth(text: string, size: number, weight = 400): number {
  const key = `${size}|${weight}|${text}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  if (measurer === undefined) measurer = typeof document === "undefined" ? null : (document.createElement("canvas").getContext("2d") ?? null);
  let w: number;
  if (measurer) {
    measurer.font = `${weight} ${size}px ${FONT}`;
    // A small margin: the file may be shown with another font.
    w = measurer.measureText(text).width * 1.06;
  } else w = estimate(text, size);
  if (widths.size > 5000) widths.clear();
  widths.set(key, w);
  return w;
}

/** Words packed into lines of at most `max` pixels (a word longer than a line is cut). */
export function wrap(text: string, size: number, max: number, weight = 400, maxLines = Infinity): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let word of words) {
    while (textWidth(word, size, weight) > max && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && textWidth(word.slice(0, cut), size, weight) > max) cut--;
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const next = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(next, size, weight) > max) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/\s*\S{0,3}$/, "")}…`;
    return kept;
  }
  return lines.length ? lines : [""];
}
