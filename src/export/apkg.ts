// Anki packages (.apkg): a zip holding a schema 11 SQLite collection
// (collection.anki2) that every Anki version imports, written with sql.js.
// Two note types ("amphi Basic", "amphi Cloze"), one deck per lesson under its
// course, every card new (no review history). Ported from Cursus's writer.

import { sha1 } from "@noble/hashes/legacy.js";
import type { SqlJsStatic } from "sql.js";
import { type AnkiDeck, clozeNumbers, markdownToAnki } from "./anki.ts";

export const BASIC_ID = 1_700_000_000_001;
export const CLOZE_ID = 1_700_000_000_002;

let sql: Promise<SqlJsStatic> | null = null;

/** sql.js, loaded on first use; in the browser its wasm is the copy the site serves (vendor/sql-wasm.wasm). */
export function loadSql(): Promise<SqlJsStatic> {
  sql ??= import("sql.js").then(({ default: init }) => (typeof document === "undefined" ? init() : init({ locateFile: () => new URL("vendor/sql-wasm.wasm", document.baseURI).href })));
  sql.catch(() => {
    sql = null;
  });
  return sql;
}

const CSS = ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }";

function model(id: number, name: string, cloze: boolean, mod: number): Record<string, unknown> {
  const fields = cloze ? ["Text", "Back Extra"] : ["Front", "Back"];
  const tmpl = cloze ? { qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}<br>\n{{Back Extra}}" } : { qfmt: "{{Front}}", afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}" };
  return {
    id,
    name,
    type: cloze ? 1 : 0,
    mod,
    usn: -1,
    sortf: 0,
    did: null,
    tmpls: [{ name: cloze ? "Cloze" : "Card 1", ord: 0, ...tmpl, bqfmt: "", bafmt: "", did: null, bfont: "", bsize: 0 }],
    flds: fields.map((f, ord) => ({ name: f, ord, sticky: false, rtl: false, font: "Arial", size: 20, media: [] })),
    css: CSS,
    latexPre: "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
    latexPost: "\\end{document}",
    latexsvg: false,
    req: [[0, "any", [0]]],
    tags: [],
    vers: [],
  };
}

function deck(id: number, name: string, mod: number): Record<string, unknown> {
  return { id, name, mod, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: false, browserCollapsed: false, desc: "", dyn: 0, conf: 1, extendNew: 0, extendRev: 0 };
}

/** Anki's duplicate check: the first 8 hex digits of the sha1 of the sort field without HTML. */
function checksum(field: string): number {
  const h = sha1(new TextEncoder().encode(field.replace(/<[^>]*>/g, "")));
  return ((h[0] ?? 0) * 2 ** 24 + ((h[1] ?? 0) << 16) + ((h[2] ?? 0) << 8) + (h[3] ?? 0)) >>> 0;
}

/** A guid Anki keeps across imports, so importing the same package again updates instead of duplicating. */
function guid(deckName: string, front: string): string {
  const h = sha1(new TextEncoder().encode(`amphi\x1f${deckName}\x1f${front}`));
  return Array.from(h.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Schema 11 DDL, as Anki 2.1 legacy exports write it. */
const SCHEMA11_DDL = `
create table col (id integer primary key, crt integer not null, mod integer not null, scm integer not null,
  ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null,
  models text not null, decks text not null, dconf text not null, tags text not null);
create table notes (id integer primary key, guid text not null, mid integer not null, mod integer not null,
  usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null,
  flags integer not null, data text not null);
create table cards (id integer primary key, nid integer not null, did integer not null, ord integer not null,
  mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null,
  ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null,
  odue integer not null, odid integer not null, flags integer not null, data text not null);
create table revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null,
  ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
create table graves (usn integer not null, oid integer not null, type integer not null);
create index ix_notes_usn on notes (usn);
create index ix_cards_usn on cards (usn);
create index ix_revlog_usn on revlog (usn);
create index ix_cards_nid on cards (nid);
create index ix_cards_sched on cards (did, queue, due);
create index ix_revlog_cid on revlog (cid);
create index ix_notes_csum on notes (csum);
`;

/** The decks as an .apkg. */
export async function buildApkg(decks: AnkiDeck[], now = Date.now()): Promise<Uint8Array> {
  const [SQL, { zipSync }] = await Promise.all([loadSql(), import("fflate")]);
  const secs = Math.floor(now / 1000);
  const db = new SQL.Database();
  try {
    db.exec(SCHEMA11_DDL);
    const deckJson: Record<string, unknown> = { "1": deck(1, "Default", secs) };
    // Parents first: Anki wants every level of a nested deck to exist.
    const ids = new Map<string, number>();
    let nextDeck = now;
    const deckId = (name: string): number => {
      const key = name.toLowerCase();
      const known = ids.get(key);
      if (known !== undefined) return known;
      const parts = name.split("::");
      if (parts.length > 1) deckId(parts.slice(0, -1).join("::"));
      const id = nextDeck++;
      ids.set(key, id);
      deckJson[String(id)] = deck(id, name, secs);
      return id;
    };
    const insNote = db.prepare("insert into notes values (?,?,?,?,?,?,?,?,?,?,?)");
    const insCard = db.prepare("insert into cards values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    let nextId = now;
    let pos = 0;
    for (const d of decks) {
      const did = deckId(d.name);
      for (const c of d.cards) {
        const front = markdownToAnki(c.front);
        const back = markdownToAnki(c.back);
        const cloze = c.kind === "cloze";
        const ords = cloze ? clozeNumbers(front).map((n) => n - 1) : [0];
        if (!ords.length) continue;
        const nid = nextId++;
        const tags = c.tags.length ? ` ${c.tags.join(" ")} ` : "";
        insNote.run([nid, guid(d.name, front), cloze ? CLOZE_ID : BASIC_ID, secs, -1, tags, `${front}\x1f${back}`, front, checksum(front), 0, ""]);
        const due = pos++;
        // New cards: type 0, queue 0, due = position in the new queue.
        for (const ord of ords) insCard.run([nextId++, nid, did, ord, secs, -1, 0, 0, due, 0, 0, 0, 0, 0, 0, 0, 0, ""]);
      }
    }
    insNote.free();
    insCard.free();
    const models = { [String(BASIC_ID)]: model(BASIC_ID, "amphi Basic", false, secs), [String(CLOZE_ID)]: model(CLOZE_ID, "amphi Cloze", true, secs) };
    const crt = Math.floor(now / 86_400_000) * 86_400;
    db.run("insert into col values (1,?,?,?,11,0,0,0,?,?,?,?,?)", [crt, now, now, JSON.stringify({ nextPos: pos, curDeck: 1, schedVer: 2, sched2021: true }), JSON.stringify(models), JSON.stringify(deckJson), "{}", "{}"]);
    return zipSync({ "collection.anki2": db.export(), media: new TextEncoder().encode("{}") });
  } finally {
    db.close();
  }
}
