// Flashcards: basic (question / answer) and cloze ({{c1::…}}) cards made
// from the sources, each naming its concept and the passage it comes from.
// Edited in place, reviewed here (each answer is a study event for
// Progress), and exported to Anki (.apkg, plain text) or Cursus.

import { useMemo, useState } from "react";
import { z } from "zod";
import { budgetFor, buildContext } from "../ai/context.ts";
import { capabilities, writeIn } from "../ai/llm.ts";
import { askJson } from "../ai/structured.ts";
import { fresh, newId, put } from "../data/db.ts";
import type { Artifact } from "../data/schema.ts";
import { type T, trIn, useLang } from "../i18n.ts";
import { openCitation } from "../ui/cite.ts";
import { Icon } from "../ui/icons.tsx";
import { Field, Notice, slug } from "../ui/kit.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { ankiDeck, type CardKind, clozeAnswer, clozeQuestion, type Flashcard, type FlashcardsData, HAS_CLOZE, label } from "./cards.ts";
import { kind, type OptionsProps, type ViewProps } from "./types.ts";

export interface FlashcardsOptions extends Record<string, unknown> {
  count: 10 | 20 | 40;
  kinds: CardKind | "both";
  focus: string;
}

const AnswerSchema = z.object({
  cards: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("basic"), front: z.string().trim().min(1), back: z.string().trim().min(1), concept: z.string().default(""), source: z.string().optional() }),
        z.object({ kind: z.literal("cloze"), text: z.string().regex(HAS_CLOZE, "needs a {{c1::…}} deletion"), extra: z.string().optional(), concept: z.string().default(""), source: z.string().optional() }),
      ]),
    )
    .min(1),
});

const SHAPE = `{"cards": [
  {"kind": "basic", "front": "question", "back": "short answer", "concept": "the notion tested, 1 to 4 words", "source": "S1 p.3"},
  {"kind": "cloze", "text": "a sentence with the {{c1::key term}} hidden", "extra": "optional context shown with the answer", "concept": "…", "source": "S2 §1"}
]}`;

const KINDS: Record<FlashcardsOptions["kinds"], string> = {
  basic: 'Only "basic" cards: a precise question on the front, a short answer on the back.',
  cloze: 'Only "cloze" cards: a sentence from the material with its key term hidden as {{c1::term}}; add {{c2::…}} only for a second term that belongs to the same fact.',
  both: 'Mix both: "cloze" for definitions, facts, dates and formulas; "basic" for explanations, causes, comparisons and applications.',
};

export const kindLabel = (k: CardKind, t: T) => (k === "basic" ? t("Question / answer", "Question / réponse", "Frage / Antwort") : t("Cloze", "Texte à trous", "Lückentext"));

function Options({ value, onChange }: OptionsProps<FlashcardsOptions>) {
  const { t } = useLang();
  return (
    <div className="stack">
      <Field label={t("Number of cards", "Nombre de cartes", "Anzahl der Karten")}>
        <select value={value.count} onChange={(e) => onChange({ ...value, count: Number(e.currentTarget.value) as FlashcardsOptions["count"] })}>
          {[10, 20, 40].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("Kind of cards", "Type de cartes", "Art der Karten")}>
        <select value={value.kinds} onChange={(e) => onChange({ ...value, kinds: e.currentTarget.value as FlashcardsOptions["kinds"] })}>
          <option value="both">{t("Both", "Les deux", "Beide")}</option>
          <option value="basic">{kindLabel("basic", t)}</option>
          <option value="cloze">{kindLabel("cloze", t)}</option>
        </select>
      </Field>
      <Field label={t("Focus (optional)", "Angle (facultatif)", "Schwerpunkt (optional)")}>
        <input value={value.focus} onChange={(e) => onChange({ ...value, focus: e.currentTarget.value })} placeholder={t("e.g. the definitions, chapter 2", "ex. les définitions, le chapitre 2", "z. B. die Definitionen, Kapitel 2")} />
      </Field>
    </div>
  );
}

function CardEditor({ card, onSave, onCancel }: { card: Flashcard; onSave: (c: Flashcard) => void; onCancel: () => void }) {
  const { t } = useLang();
  const [c, setC] = useState(card);
  const cloze = c.kind === "cloze";
  const problem = !c.front.trim()
    ? t("Write the front.", "Écrivez le recto.", "Schreiben Sie die Vorderseite.")
    : cloze && !HAS_CLOZE.test(c.front)
      ? t("Hide at least one term as {{c1::term}}.", "Masquez au moins un terme sous la forme {{c1::terme}}.", "Verbergen Sie mindestens einen Begriff als {{c1::Begriff}}.")
      : !cloze && !c.back.trim()
        ? t("Write the answer.", "Écrivez la réponse.", "Schreiben Sie die Antwort.")
        : "";
  return (
    <form
      className="stack card-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) onSave({ ...c, front: c.front.trim(), back: c.back.trim(), concept: c.concept.trim(), cite: label(c.cite) });
      }}
    >
      <Field label={t("Kind", "Type", "Art")}>
        <select value={c.kind} onChange={(e) => setC({ ...c, kind: e.currentTarget.value as CardKind })}>
          <option value="basic">{kindLabel("basic", t)}</option>
          <option value="cloze">{kindLabel("cloze", t)}</option>
        </select>
      </Field>
      <Field label={cloze ? t("Text", "Texte", "Text") : t("Front", "Recto", "Vorderseite")} hint={cloze ? t("Hide terms as {{c1::term}}.", "Masquez les termes sous la forme {{c1::terme}}.", "Verbergen Sie Begriffe als {{c1::Begriff}}.") : undefined}>
        <textarea rows={3} value={c.front} onChange={(e) => setC({ ...c, front: e.currentTarget.value })} />
      </Field>
      <Field label={cloze ? t("Extra (optional)", "Complément (facultatif)", "Zusatz (optional)") : t("Back", "Verso", "Rückseite")}>
        <textarea rows={3} value={c.back} onChange={(e) => setC({ ...c, back: e.currentTarget.value })} />
      </Field>
      <Field label={t("Concept", "Notion", "Begriff")}>
        <input value={c.concept} onChange={(e) => setC({ ...c, concept: e.currentTarget.value })} />
      </Field>
      <Field label={t("Source passage", "Passage source", "Quellstelle")} hint={t("e.g. S1 p.3", "ex. S1 p.3", "z. B. S1 p.3")}>
        <input value={c.cite ?? ""} onChange={(e) => setC({ ...c, cite: e.currentTarget.value })} />
      </Field>
      {problem ? <p className="meta">{problem}</p> : null}
      <div className="row end">
        <button type="button" className="secondary" onClick={onCancel}>
          {t("Cancel", "Annuler", "Abbrechen")}
        </button>
        <button type="submit" className="primary" disabled={Boolean(problem)}>
          {t("Save", "Enregistrer", "Speichern")}
        </button>
      </div>
    </form>
  );
}

const question = (c: Flashcard) => (c.kind === "cloze" ? clozeQuestion(c.front) : c.front);
const answer = (c: Flashcard) => (c.kind === "cloze" ? [clozeAnswer(c.front), c.back].filter(Boolean).join("\n\n") : c.back);

function Cite({ card, artifact }: { card: Flashcard; artifact: Artifact<FlashcardsData> }) {
  const { t } = useLang();
  if (!card.cite) return null;
  return (
    <button type="button" className="cite" title={t("Open the passage", "Ouvrir le passage", "Stelle öffnen")} onClick={() => openCitation(card.cite!, artifact.sourceIds)}>
      {card.cite}
    </button>
  );
}

interface Session {
  queue: Flashcard[];
  i: number;
  shown: boolean;
  known: number;
  missed: Flashcard[];
}

function Review({ session, setSession, artifact }: { session: Session; setSession: (s: Session | null) => void; artifact: Artifact<FlashcardsData> }) {
  const { t } = useLang();
  const card = session.queue[session.i];
  if (!card)
    return (
      <section className="stack review" aria-label={t("Review", "Révision", "Wiederholung")}>
        <p className="lead" role="status">
          {t(`You knew ${session.known} of ${session.queue.length}.`, `Vous en connaissiez ${session.known} sur ${session.queue.length}.`, `Sie wussten ${session.known} von ${session.queue.length}.`)}
        </p>
        <div className="row">
          {session.missed.length ? (
            <button type="button" className="primary" onClick={() => setSession({ queue: session.missed, i: 0, shown: false, known: 0, missed: [] })}>
              <Icon name="refresh" size={18} /> {t("Review the missed ones", "Revoir celles manquées", "Die verpassten wiederholen")}
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={() => setSession(null)}>
            {t("Done", "Terminé", "Fertig")}
          </button>
        </div>
      </section>
    );
  const grade = async (knew: boolean) => {
    await put("events", { ...fresh(), courseId: artifact.courseId, artifactId: artifact.id, kind: "card", concept: card.concept || undefined, score: knew ? 1 : 0, at: Date.now() });
    setSession({ ...session, i: session.i + 1, shown: false, known: session.known + (knew ? 1 : 0), missed: knew ? session.missed : [...session.missed, card] });
  };
  return (
    <section className="stack review" aria-label={t("Review", "Révision", "Wiederholung")}>
      <div className="row">
        <span className="meta">{t(`Card ${session.i + 1} of ${session.queue.length}`, `Carte ${session.i + 1} sur ${session.queue.length}`, `Karte ${session.i + 1} von ${session.queue.length}`)}</span>
        {card.concept ? <span className="meta">· {card.concept}</span> : null}
        <button type="button" className="secondary small" onClick={() => setSession(null)}>
          {t("Stop", "Arrêter", "Beenden")}
        </button>
      </div>
      <div className="flashcard">
        <Markdown text={question(card)} />
        {session.shown ? (
          <>
            <hr />
            <Markdown text={answer(card)} />
            <Cite card={card} artifact={artifact} />
          </>
        ) : null}
      </div>
      <div className="row">
        {session.shown ? (
          <>
            <button key="no" type="button" className="secondary" onClick={() => void grade(false)}>
              <Icon name="x" size={18} /> {t("Didn't know", "Je ne savais pas", "Wusste ich nicht")}
            </button>
            <button key="yes" type="button" className="primary" onClick={() => void grade(true)}>
              <Icon name="check" size={18} /> {t("Knew it", "Je savais", "Wusste ich")}
            </button>
          </>
        ) : (
          <button key="show" type="button" className="primary" onClick={() => setSession({ ...session, shown: true })}>
            {t("Show the answer", "Voir la réponse", "Antwort zeigen")}
          </button>
        )}
      </div>
    </section>
  );
}

function View({ artifact, onChange }: ViewProps<FlashcardsData>) {
  const { t } = useLang();
  const cards = artifact.data.cards;
  const [concept, setConcept] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const concepts = useMemo(() => [...new Set(cards.map((c) => c.concept).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [cards]);
  const shown = concept ? cards.filter((c) => c.concept === concept) : cards;
  const save = (next: Flashcard[]) => onChange({ ...artifact.data, cards: next });
  if (session) return <Review session={session} setSession={setSession} artifact={artifact} />;
  const blank: Flashcard = { id: "", kind: "basic", front: "", back: "", concept };
  return (
    <div className="stack">
      <div className="row wrap no-print">
        <button type="button" className="primary" disabled={!shown.length} onClick={() => setSession({ queue: shown, i: 0, shown: false, known: 0, missed: [] })}>
          <Icon name="play" size={18} /> {t("Review", "Réviser", "Wiederholen")} ({shown.length})
        </button>
        <button type="button" className="secondary" onClick={() => setEditing("new")}>
          <Icon name="plus" size={18} /> {t("Add a card", "Ajouter une carte", "Karte hinzufügen")}
        </button>
        {concepts.length > 1 ? (
          <select className="flashcards-filter" aria-label={t("Filter by concept", "Filtrer par notion", "Nach Begriff filtern")} value={concept} onChange={(e) => setConcept(e.currentTarget.value)}>
            <option value="">{t("All concepts", "Toutes les notions", "Alle Begriffe")}</option>
            {concepts.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {editing === "new" ? (
        <CardEditor
          card={blank}
          onCancel={() => setEditing(null)}
          onSave={(c) => {
            save([...cards, { ...c, id: newId() }]);
            setEditing(null);
          }}
        />
      ) : null}
      {!cards.length ? <Notice>{t("No card left: add one.", "Plus aucune carte : ajoutez-en une.", "Keine Karte mehr: Fügen Sie eine hinzu.")}</Notice> : null}
      <ol className="list flashcard-list" aria-label={t("Cards", "Cartes", "Karten")}>
        {shown.map((c) =>
          editing === c.id ? (
            <li key={c.id} className="list-item">
              <CardEditor
                card={c}
                onCancel={() => setEditing(null)}
                onSave={(next) => {
                  save(cards.map((x) => (x.id === c.id ? next : x)));
                  setEditing(null);
                }}
              />
            </li>
          ) : (
            <li key={c.id} className="list-item flashcard-row">
              <div className="list-main">
                <Markdown text={question(c)} className="flashcard-front" />
                <Markdown text={answer(c)} className="flashcard-back" />
                <span className="meta">
                  {kindLabel(c.kind, t)}
                  {c.concept ? ` · ${c.concept}` : ""} <Cite card={c} artifact={artifact} />
                </span>
              </div>
              <div className="row no-print">
                <button type="button" className="icon-button" aria-label={t("Edit the card", "Modifier la carte", "Karte bearbeiten")} onClick={() => setEditing(c.id)}>
                  <Icon name="edit" size={18} />
                </button>
                <button type="button" className="icon-button" aria-label={t("Delete the card", "Supprimer la carte", "Karte löschen")} onClick={() => save(cards.filter((x) => x.id !== c.id))}>
                  <Icon name="trash" size={18} />
                </button>
              </div>
            </li>
          ),
        )}
      </ol>
    </div>
  );
}

export const flashcards = kind<FlashcardsData, FlashcardsOptions>({
  type: "flashcards",
  icon: "cards",
  label: (t) => t("Flashcards", "Cartes mémoire", "Karteikarten"),
  blurb: (t) => t("Question and cloze cards, reviewed here or in Anki and Cursus", "Cartes question et texte à trous, à réviser ici ou dans Anki et Cursus", "Frage- und Lückentextkarten, hier oder in Anki und Cursus zu lernen"),
  defaults: { count: 20, kinds: "both", focus: "" },
  Options,
  async generate(ctx, o) {
    ctx.progress({ label: "" });
    const context = buildContext(ctx.sources, { query: o.focus || undefined, budget: budgetFor(capabilities().contextWindow) });
    const reply = await askJson(AnswerSchema, {
      system: `You write flashcards for a university student from their own course sources. Write ${o.count} cards, each testing one idea that matters for an exam, short and unambiguous, answerable without seeing the other cards. ${KINDS[o.kinds]} Give each card its "concept": the notion it tests in 1 to 4 words, worded the same for every card on that notion. Give each card its "source": the label of the passage it comes from, exactly as written in the sources (e.g. S1 p.3). Ground every card in the sources; never invent facts they do not support. Cards may use Markdown and $…$ for math. Write in ${writeIn(ctx.language)}.`,
      prompt: `${o.focus ? `Focus on: ${o.focus}\n\n` : ""}${context.text}`,
      shape: SHAPE,
      signal: ctx.signal,
    });
    const cards: Flashcard[] = reply.cards.map((c) =>
      c.kind === "basic"
        ? { id: newId(), kind: "basic", front: c.front, back: c.back, concept: c.concept.trim(), cite: label(c.source) }
        : { id: newId(), kind: "cloze", front: c.text.trim(), back: c.extra?.trim() ?? "", concept: c.concept.trim(), cite: label(c.source) },
    );
    const title = `${trIn(ctx.language)("Flashcards", "Cartes mémoire", "Karteikarten")} · ${ctx.lesson?.title ?? ctx.course.title}`;
    return { title, data: { cards } };
  },
  View,
  exports: [
    {
      id: "apkg",
      label: (t) => t("Anki (.apkg)", "Anki (.apkg)", "Anki (.apkg)"),
      run: async (a, ctx) => {
        const { buildApkg } = await import("../export/apkg.ts");
        const bytes = await buildApkg([ankiDeck(a, ctx)]);
        return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }), filename: `${slug(a.title)}.apkg` };
      },
    },
    {
      id: "tsv",
      label: (t) => t("Anki (text)", "Anki (texte)", "Anki (Text)"),
      run: async (a, ctx) => {
        const { buildTsv } = await import("../export/csv.ts");
        return { blob: new Blob([buildTsv(ankiDeck(a, ctx))], { type: "text/tab-separated-values" }), filename: `${slug(a.title)}.tsv` };
      },
    },
    {
      id: "cursus",
      label: (t) => t("Cursus", "Cursus", "Cursus"),
      run: async (a, ctx) => (await import("../export/cursus.ts")).artifactToCursus(a, ctx),
    },
  ],
});
