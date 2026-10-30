// Reads the plain-text export back with Cursus's parser
// (src/core/export/csvImport.ts parseDelimited, copied as is), which reads
// Anki's header lines the way Anki does.
import { expect, test } from "bun:test";
import { buildTsv } from "./csv.ts";

const ANKI_SEPARATORS: Record<string, string> = { tab: "\t", comma: ",", semicolon: ";", pipe: "|", space: " " };

function detect(body: string): string {
  const first = body.split("\n", 1)[0] ?? "";
  for (const s of ["\t", ";", ","]) if (first.includes(s)) return s;
  return "\t";
}

function parseDelimited(text: string): string[][] {
  const lines = text.replace(/^﻿/, "");
  let sep: string | undefined;
  let body = "";
  for (const line of lines.split(/(?<=\n)/)) {
    const m = /^#([\w ]+):(.*?)\r?\n?$/.exec(line);
    if (m && body === "") {
      if (m[1] === "separator") sep = ANKI_SEPARATORS[m[2]?.toLowerCase() ?? ""] ?? m[2];
      continue;
    }
    body += line;
  }
  sep ??= detect(body);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const headers = (tsv: string) => tsv.split("\n").filter((l) => l.startsWith("#"));

test("basic cards: Anki's header lines, then front, back and tags as HTML", () => {
  const tsv = buildTsv({
    name: "Thermodynamics::Lesson 1",
    cards: [
      { kind: "basic", front: "What does **entropy** measure?", back: "Disorder", tags: ["Thermodynamics", "Lesson_1", "entropy"] },
      { kind: "basic", front: 'A "quoted"\tfield', back: "Line one\n\nLine two\n\n```\ncode\n  kept\n```", tags: [] },
    ],
  });
  expect(headers(tsv)).toEqual(["#separator:tab", "#html:true", "#deck:Thermodynamics::Lesson 1", "#tags column:3"]);
  expect(parseDelimited(tsv)).toEqual([
    ["What does <strong>entropy</strong> measure?", "Disorder", "Thermodynamics Lesson_1 entropy"],
    ["A &quot;quoted&quot;\tfield", "<p>Line one</p><p>Line two</p><pre><code>code\n  kept\n</code></pre>", ""],
  ]);
});

test("with cloze cards, a fourth column names each note type", () => {
  const tsv = buildTsv({
    name: "Physics",
    cards: [
      { kind: "cloze", front: "Entropy never {{c1::decreases}}.", back: "", tags: ["entropy"] },
      { kind: "basic", front: "Q", back: "A", tags: [] },
    ],
  });
  expect(headers(tsv)).toEqual(["#separator:tab", "#html:true", "#deck:Physics", "#tags column:3", "#notetype column:4"]);
  expect(parseDelimited(tsv)).toEqual([
    ["Entropy never {{c1::decreases}}.", "", "entropy", "Cloze"],
    ["Q", "A", "", "Basic"],
  ]);
});
