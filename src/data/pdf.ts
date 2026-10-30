// The text of a PDF, page by page, read by pdf.js in its own worker (served
// by this site, see scripts/build.ts). Nothing is rendered and no script in
// the PDF runs.

import type { SourcePage } from "./schema.ts";
import { scriptURL } from "../trusted.ts";

let worker: Worker | null = null;

export async function pdfPages(data: ArrayBuffer): Promise<{ pages: SourcePage[]; title?: string }> {
  const pdfjs = await import("pdfjs-dist");
  worker ??= new Worker(scriptURL("./vendor/pdf.worker.mjs"), { type: "module", name: "amphi-pdf" });
  pdfjs.GlobalWorkerOptions.workerPort = worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(data), enableXfa: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false });
  const doc = await task.promise;
  try {
    const pages: SourcePage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str + (item.hasEOL ? "\n" : "");
      }
      // Lines that end a sentence or are short start a new paragraph.
      text = text
        .replace(/[ \t]+\n/g, "\n")
        .replace(/([.!?:;])\n(?=\S)/g, "$1\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
      pages.push({ n, text });
      page.cleanup();
    }
    const meta = await doc.getMetadata().catch(() => null);
    const title = (meta?.info as { Title?: string } | undefined)?.Title?.trim() || undefined;
    return { pages, title };
  } finally {
    await task.destroy();
  }
}
