// Reads back the .apkg the way Anki and Cursus do: the zip's collection.anki2
// opened with sql.js, its note types and decks from `col`, its notes and
// cards (the reader below is Cursus's, src/core/anki/schema11.ts and
// apkgRead.ts, cut down to what is checked here).
import { expect, test } from "bun:test";
import { unzipSync } from "fflate";
import type { Database, SqlValue } from "sql.js";
import { buildApkg, BASIC_ID, CLOZE_ID, loadSql } from "./apkg.ts";

interface AnkiNotetype {
  name: string;
  kind: "normal" | "cloze";
  fields: string[];
}
interface AnkiNote {
  id: number;
  guid: string;
  mid: number;
  fields: string[];
  tags: string[];
}

const rows = (db: Database, sql: string): SqlValue[][] => db.exec(sql)[0]?.values ?? [];
const num = (v: SqlValue | undefined) => Number(v ?? 0);
const str = (v: SqlValue | undefined) => (v === null || v === undefined ? "" : String(v));

function readSchema11(db: Database) {
  const col = rows(db, "select models, decks from col")[0];
  if (!col) throw new Error("Anki collection has no col row");
  const models = JSON.parse(str(col[0])) as Record<string, { name?: string; type?: number; flds?: { name?: string; ord?: number }[] }>;
  const decksJson = JSON.parse(str(col[1])) as Record<string, { name?: string }>;
  const notetypes = new Map<number, AnkiNotetype>();
  for (const [id, m] of Object.entries(models)) {
    const flds = [...(m.flds ?? [])].sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
    notetypes.set(Number(id), { name: m.name ?? "", kind: m.type === 1 ? "cloze" : "normal", fields: flds.map((f) => f.name ?? "") });
  }
  const decks = new Map<number, string[]>();
  for (const [id, d] of Object.entries(decksJson)) decks.set(Number(id), (d.name ?? "").split("::"));
  const notes = new Map<number, AnkiNote>();
  for (const r of rows(db, "select id, guid, mid, flds, tags from notes order by id")) {
    notes.set(num(r[0]), { id: num(r[0]), guid: str(r[1]), mid: num(r[2]), fields: str(r[3]).split("\x1f"), tags: str(r[4]).split(" ").filter(Boolean) });
  }
  const cards = rows(db, "select id, nid, did, ord, queue, type from cards order by nid, ord").map((r) => ({ id: num(r[0]), nid: num(r[1]), did: num(r[2]), ord: num(r[3]), queue: num(r[4]), type: num(r[5]) }));
  return { notetypes, decks, notes, cards };
}

const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

/** Cursus's cardSides: the front and back of one Anki card. */
function cardSides(note: AnkiNote, type: AnkiNotetype, ord: number): { front: string; back: string } {
  const f = note.fields;
  const label = (skip: Set<number>): string[] => f.flatMap((v, i) => (skip.has(i) || v.trim() === "" ? [] : [`<p><b>${type.fields[i] ?? `Field ${i + 1}`}:</b> ${v}</p>`]));
  if (type.kind === "cloze") {
    const index = ord + 1;
    const front = (f[0] ?? "").replace(CLOZE, (m, n: string, answer: string) => (Number(n) === index ? m : answer));
    return { front, back: label(new Set([0])).join("") };
  }
  const frontIdx = ord < f.length ? ord : 0;
  const backIdx = frontIdx === 0 ? 1 : 0;
  const extras = label(new Set([frontIdx, backIdx]));
  return { front: f[frontIdx] ?? "", back: [f[backIdx] ?? "", ...extras].filter(Boolean).join("") };
}

/** Cursus's deckPlacement: `A::B::C` is course A, subsets B › C. */
function deckPlacement(path: readonly string[]) {
  const p = (path.length > 1 && path[0] === "Cursus" ? path.slice(1) : path).map((s) => s.trim());
  const [course, ...sections] = p;
  return { course: course || "Anki", sections: sections.map((s) => s || "Anki") };
}

async function open(bytes: Uint8Array) {
  const zip = unzipSync(bytes);
  expect(Object.keys(zip).sort()).toEqual(["collection.anki2", "media"]);
  expect(JSON.parse(new TextDecoder().decode(zip.media))).toEqual({});
  const SQL = await loadSql();
  const db = new SQL.Database(zip["collection.anki2"]);
  return db;
}

test("an .apkg holds a schema 11 collection Anki and Cursus read: note types, nested decks, notes, one card per cloze number", async () => {
  const bytes = await buildApkg(
    [
      {
        name: "Thermodynamics::Lesson 1",
        cards: [
          { kind: "basic", front: "What does **entropy** measure?", back: "Disorder: $S = k \\ln W$\n\n*Entropy, §1*", tags: ["Thermodynamics", "Lesson_1", "entropy"] },
          { kind: "cloze", front: "In an {{c1::isolated}} system entropy never {{c2::decreases::goes …}}.", back: "", tags: ["Thermodynamics"] },
        ],
      },
      { name: "Thermodynamics", cards: [{ kind: "basic", front: "Q", back: "A", tags: [] }] },
    ],
    1_750_000_000_000,
  );
  const db = await open(bytes);
  try {
    expect(rows(db, "pragma integrity_check")[0]?.[0]).toBe("ok");
    expect(num(rows(db, "select ver from col")[0]?.[0])).toBe(11);
    const c = readSchema11(db);
    expect(c.notetypes.get(BASIC_ID)).toEqual({ name: "amphi Basic", kind: "normal", fields: ["Front", "Back"] });
    expect(c.notetypes.get(CLOZE_ID)).toEqual({ name: "amphi Cloze", kind: "cloze", fields: ["Text", "Back Extra"] });
    const names = [...c.decks.values()].map((p) => p.join("::")).sort();
    expect(names).toEqual(["Default", "Thermodynamics", "Thermodynamics::Lesson 1"]);
    const deckOf = (name: string) => [...c.decks].find(([, p]) => p.join("::") === name)![0];

    const notes = [...c.notes.values()];
    expect(notes).toHaveLength(3);
    const [basic, cloze, plain] = notes as [AnkiNote, AnkiNote, AnkiNote];
    expect(basic.mid).toBe(BASIC_ID);
    expect(basic.fields).toEqual(["What does <strong>entropy</strong> measure?", "<p>Disorder: \\(S = k \\ln W\\)</p><p><em>Entropy, §1</em></p>"]);
    expect(basic.tags).toEqual(["Thermodynamics", "Lesson_1", "entropy"]);
    expect(cloze.mid).toBe(CLOZE_ID);
    expect(new Set(notes.map((n) => n.guid)).size).toBe(3);

    // One card per note, but a cloze note has one per deletion number; all new, in their deck.
    const byNote = (n: AnkiNote) => c.cards.filter((k) => k.nid === n.id);
    expect(byNote(basic).map((k) => [k.ord, k.did, k.queue, k.type])).toEqual([[0, deckOf("Thermodynamics::Lesson 1"), 0, 0]]);
    expect(byNote(cloze).map((k) => k.ord)).toEqual([0, 1]);
    expect(byNote(plain).map((k) => k.did)).toEqual([deckOf("Thermodynamics")]);

    // What Cursus makes of them.
    const type = c.notetypes.get(CLOZE_ID)!;
    expect(cardSides(cloze, type, 1).front).toBe("In an isolated system entropy never {{c2::decreases::goes …}}.");
    expect(cardSides(cloze, type, 0).front).toBe("In an {{c1::isolated}} system entropy never decreases.");
    expect(cardSides(basic, c.notetypes.get(BASIC_ID)!, 0).back).toContain("Disorder");
    expect(deckPlacement(c.decks.get(byNote(basic)[0]!.did)!)).toEqual({ course: "Thermodynamics", sections: ["Lesson 1"] });
  } finally {
    db.close();
  }
});

test("the same cards keep the same guids, so a second import updates instead of duplicating", async () => {
  const deck = { name: "Physics", cards: [{ kind: "basic" as const, front: "Q", back: "A", tags: [] }] };
  const guids = async (at: number) => {
    const db = await open(await buildApkg([deck], at));
    try {
      return rows(db, "select guid from notes").map((r) => r[0]);
    } finally {
      db.close();
    }
  };
  expect(await guids(1)).toEqual(await guids(2_000_000));
});
