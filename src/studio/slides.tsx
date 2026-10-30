// Slide decks: titles, bullets, two columns, quotes, diagrams and key figures
// with speaker notes, written by the model as text and drawn by our own
// layouts (16:9). Edited in place (text, order, adding and removing slides),
// presented full screen with the keyboard, exported to PowerPoint, printed
// to PDF one slide a page, or as a Markdown outline.

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { budgetFor, buildContext, CITE_RULE } from "../ai/context.ts";
import { capabilities, writeIn } from "../ai/llm.ts";
import { askJson } from "../ai/structured.ts";
import { type T, useLang } from "../i18n.ts";
import { openCitation } from "../ui/cite.ts";
import { Icon } from "../ui/icons.tsx";
import { Field, slug } from "../ui/kit.tsx";
import { DIAGRAMS, type DiagramKind, emptySlide, LAYOUTS, MAX_BULLETS, MAX_ITEMS, type Slide, type SlideLayout, SLIDES_SHAPE, SlidesAnswer, slidesMarkdown } from "./deck.ts";
import { buildPptx } from "./pptx.ts";
import { SceneSvg } from "./render/scene.tsx";
import { slideScene } from "./render/slide-layout.ts";
import { kind, type OptionsProps, type ViewProps } from "./types.ts";

export const COUNTS = [6, 10, 16] as const;
export type SlideCount = (typeof COUNTS)[number];
export const LEVELS = ["intro", "course", "review"] as const;
export type Level = (typeof LEVELS)[number];

export interface SlidesOptions extends Record<string, unknown> {
  count: SlideCount;
  level: Level;
  focus: string;
}

export interface SlidesData {
  slides: Slide[];
}

export const levelLabel = (l: Level, t: T) =>
  ({
    intro: t("Newcomers: plain words, the basics", "Débutants : des mots simples, les bases", "Einsteiger: einfache Worte, die Grundlagen"),
    course: t("Students of the course", "Étudiants du cours", "Studierende des Kurses"),
    review: t("Exam review: dense, the essentials", "Révision d'examen : dense, l'essentiel", "Prüfungsvorbereitung: dicht, das Wesentliche"),
  })[l];

const LEVEL_PROMPT: Record<Level, string> = {
  intro: "The audience is new to the subject: plain words, define every term, one idea a slide, concrete examples.",
  course: "The audience follows this course: the material at its own level, with its terms, examples and reasoning.",
  review: "The audience reviews for an exam: dense slides with the definitions, results, steps and classic pitfalls to know.",
};

export const layoutLabel = (l: SlideLayout, t: T) =>
  ({
    title: t("Title", "Titre", "Titel"),
    bullets: t("Bullets", "Puces", "Aufzählung"),
    "two-columns": t("Two columns", "Deux colonnes", "Zwei Spalten"),
    quote: t("Quote", "Citation", "Zitat"),
    diagram: t("Diagram", "Schéma", "Diagramm"),
    "key-figure": t("Key figure", "Chiffre clé", "Kennzahl"),
  })[l];

export const diagramLabel = (d: DiagramKind, t: T) =>
  ({
    steps: t("Steps", "Étapes", "Schritte"),
    cycle: t("Cycle", "Cycle", "Kreislauf"),
    comparison: t("Comparison", "Comparaison", "Vergleich"),
    hierarchy: t("Hierarchy", "Hiérarchie", "Hierarchie"),
  })[d];

/** Lists without their blank lines (kept while typing, dropped when saved and drawn). */
export function tidy<S extends Slide>(s: S): S {
  const list = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);
  return {
    ...s,
    bullets: list(s.bullets),
    columns: s.columns.map((c) => ({ ...c, bullets: list(c.bullets) })) as Slide["columns"],
    diagram: { ...s.diagram, items: s.diagram.items.map((it) => ({ ...it, children: list(it.children) })) },
  };
}

function Options({ value, onChange }: OptionsProps<SlidesOptions>) {
  const { t } = useLang();
  return (
    <div className="stack">
      <Field label={t("Number of slides", "Nombre de diapositives", "Anzahl der Folien")}>
        <select value={value.count} onChange={(e) => onChange({ ...value, count: Number(e.currentTarget.value) as SlideCount })}>
          {COUNTS.map((n) => (
            <option key={n} value={n}>
              {t(`About ${n}`, `Environ ${n}`, `Etwa ${n}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("Audience", "Public", "Publikum")}>
        <select value={value.level} onChange={(e) => onChange({ ...value, level: e.currentTarget.value as Level })}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {levelLabel(l, t)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("Focus (optional)", "Angle (facultatif)", "Schwerpunkt (optional)")}>
        <input value={value.focus} onChange={(e) => onChange({ ...value, focus: e.currentTarget.value })} placeholder={t("e.g. the second law, for a talk", "ex. le deuxième principe, pour un exposé", "z. B. der zweite Hauptsatz, für ein Referat")} />
      </Field>
    </div>
  );
}

const lines = (xs: string[]) => xs.join("\n");
const unlines = (s: string) => s.split("\n");

/** The fields of one slide (or video scene); text is kept in the draft while typing and saved when a field is left. */
export function SlideEditor<S extends Slide>({ slide, set, save, notes = true }: { slide: S; set: (s: S) => void; save: (s?: S) => void; notes?: boolean }) {
  const { t } = useLang();
  const blur = () => save();
  const d = slide.diagram;
  const setItem = (i: number, patch: Partial<Slide["diagram"]["items"][number]> | null) =>
    ({ ...slide, diagram: { ...d, items: patch ? d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) : d.items.filter((_, j) => j !== i) } }) satisfies S;
  const oneLine = t("one a line", "une par ligne", "eine pro Zeile");
  return (
    <div className="stack slide-editor">
      <div className="row wrap">
        <Field label={t("Layout", "Mise en page", "Layout")}>
          <select value={slide.layout} onChange={(e) => save({ ...slide, layout: e.currentTarget.value as SlideLayout })}>
            {LAYOUTS.map((l) => (
              <option key={l} value={l}>
                {layoutLabel(l, t)}
              </option>
            ))}
          </select>
        </Field>
        {slide.layout === "diagram" ? (
          <Field label={t("Kind of diagram", "Type de schéma", "Art des Diagramms")}>
            <select value={d.kind} onChange={(e) => save({ ...slide, diagram: { ...d, kind: e.currentTarget.value as DiagramKind } })}>
              {DIAGRAMS.map((k) => (
                <option key={k} value={k}>
                  {diagramLabel(k, t)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
      <Field label={t("Slide title", "Titre de la diapositive", "Folientitel")}>
        <input value={slide.title} onChange={(e) => set({ ...slide, title: e.currentTarget.value })} onBlur={blur} />
      </Field>
      {slide.layout === "title" ? (
        <Field label={t("Subtitle", "Sous-titre", "Untertitel")}>
          <input value={slide.subtitle} onChange={(e) => set({ ...slide, subtitle: e.currentTarget.value })} onBlur={blur} />
        </Field>
      ) : null}
      {slide.layout === "bullets" || slide.layout === "key-figure" ? (
        <>
          {slide.layout === "key-figure" ? (
            <div className="row wrap">
              <Field label={t("Figure", "Chiffre", "Zahl")}>
                <input value={slide.figure.value} onChange={(e) => set({ ...slide, figure: { ...slide.figure, value: e.currentTarget.value } })} onBlur={blur} />
              </Field>
              <Field label={t("What it is", "Ce qu'il représente", "Was sie bedeutet")}>
                <input value={slide.figure.label} onChange={(e) => set({ ...slide, figure: { ...slide.figure, label: e.currentTarget.value } })} onBlur={blur} />
              </Field>
            </div>
          ) : null}
          <Field label={slide.layout === "bullets" ? t(`Bullets (${oneLine})`, `Puces (${oneLine})`, `Aufzählungspunkte (${oneLine})`) : t(`Context (${oneLine})`, `Contexte (${oneLine})`, `Kontext (${oneLine})`)}>
            <textarea rows={Math.min(MAX_BULLETS, Math.max(3, slide.bullets.length + 1))} value={lines(slide.bullets)} onChange={(e) => set({ ...slide, bullets: unlines(e.currentTarget.value) })} onBlur={blur} />
          </Field>
        </>
      ) : null}
      {slide.layout === "two-columns" ? (
        <div className="slide-columns">
          {slide.columns.map((c, i) => {
            const setCol = (patch: Partial<typeof c>) => set({ ...slide, columns: slide.columns.map((x, j) => (j === i ? { ...x, ...patch } : x)) as Slide["columns"] });
            const n = i + 1;
            return (
              <div key={n} className="stack">
                <Field label={t(`Column ${n} heading`, `Titre de la colonne ${n}`, `Überschrift von Spalte ${n}`)}>
                  <input value={c.heading} onChange={(e) => setCol({ heading: e.currentTarget.value })} onBlur={blur} />
                </Field>
                <Field label={t(`Column ${n} bullets (${oneLine})`, `Puces de la colonne ${n} (${oneLine})`, `Punkte von Spalte ${n} (${oneLine})`)}>
                  <textarea rows={4} value={lines(c.bullets)} onChange={(e) => setCol({ bullets: unlines(e.currentTarget.value) })} onBlur={blur} />
                </Field>
              </div>
            );
          })}
        </div>
      ) : null}
      {slide.layout === "quote" ? (
        <>
          <Field label={t("Quote", "Citation", "Zitat")}>
            <textarea rows={3} value={slide.quote} onChange={(e) => set({ ...slide, quote: e.currentTarget.value })} onBlur={blur} />
          </Field>
          <Field label={t("Author", "Auteur", "Autor")}>
            <input value={slide.author} onChange={(e) => set({ ...slide, author: e.currentTarget.value })} onBlur={blur} />
          </Field>
        </>
      ) : null}
      {slide.layout === "diagram" ? (
        <fieldset className="stack diagram-items">
          <legend>{t("Diagram items", "Éléments du schéma", "Elemente des Diagramms")}</legend>
          {d.kind === "hierarchy" ? (
            <Field label={t("Top of the hierarchy", "Sommet de la hiérarchie", "Spitze der Hierarchie")}>
              <input value={d.root} placeholder={slide.title} onChange={(e) => set({ ...slide, diagram: { ...d, root: e.currentTarget.value } })} onBlur={blur} />
            </Field>
          ) : null}
          {d.items.map((it, i) => {
            const n = i + 1;
            return (
              <div key={n} className="diagram-item">
                <input aria-label={t(`Item ${n}`, `Élément ${n}`, `Element ${n}`)} value={it.label} onChange={(e) => set(setItem(i, { label: e.currentTarget.value }))} onBlur={blur} />
                {d.kind === "steps" || d.kind === "cycle" ? (
                  <input aria-label={t(`Item ${n} detail`, `Détail de l'élément ${n}`, `Detail von Element ${n}`)} value={it.detail} placeholder={t("Detail (optional)", "Détail (facultatif)", "Detail (optional)")} onChange={(e) => set(setItem(i, { detail: e.currentTarget.value }))} onBlur={blur} />
                ) : (
                  <textarea
                    rows={2}
                    aria-label={t(`Item ${n} points (${oneLine})`, `Points de l'élément ${n} (${oneLine})`, `Punkte von Element ${n} (${oneLine})`)}
                    value={lines(it.children)}
                    onChange={(e) => set(setItem(i, { children: unlines(e.currentTarget.value) }))}
                    onBlur={blur}
                  />
                )}
                <button type="button" className="icon-button" aria-label={t(`Remove item ${n}`, `Supprimer l'élément ${n}`, `Element ${n} entfernen`)} onClick={() => save(setItem(i, null))}>
                  <Icon name="trash" size={18} />
                </button>
              </div>
            );
          })}
          {d.items.length < MAX_ITEMS ? (
            <div className="row">
              <button type="button" className="secondary" onClick={() => save({ ...slide, diagram: { ...d, items: [...d.items, { label: "", detail: "", children: [] }] } })}>
                <Icon name="plus" size={18} /> {t("Add an item", "Ajouter un élément", "Element hinzufügen")}
              </button>
            </div>
          ) : null}
        </fieldset>
      ) : null}
      {notes ? (
        <Field label={t("Speaker notes", "Notes de l'orateur", "Sprechernotizen")}>
          <textarea rows={4} value={slide.notes} onChange={(e) => set({ ...slide, notes: e.currentTarget.value })} onBlur={blur} />
        </Field>
      ) : null}
    </div>
  );
}

/** Full screen, one slide at a time: arrows, Page Up/Down, Space, Home/End; N shows the notes; Escape leaves. */
function Presenter({ slides, start, onCite, onClose }: { slides: Slide[]; start: number; onCite: (label: string) => void; onClose: (at: number) => void }) {
  const { t } = useLang();
  const [i, setI] = useState(Math.min(start, slides.length - 1));
  const [notes, setNotes] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const at = useRef(i);
  at.current = i;
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = ref.current;
    el?.focus();
    let full = false;
    const changed = () => {
      // Leaving full screen (Escape, the browser's own controls) leaves the presentation.
      if (document.fullscreenElement === el) full = true;
      else if (full) close.current(at.current);
    };
    document.addEventListener("fullscreenchange", changed);
    if (el?.requestFullscreen && document.fullscreenEnabled) el.requestFullscreen().catch(() => {});
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);
  const go = (n: number) => setI(Math.max(0, Math.min(slides.length - 1, n)));
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " ") go(i + 1);
    else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || k === "Backspace") go(i - 1);
    else if (k === "Home") go(0);
    else if (k === "End") go(slides.length - 1);
    else if (k === "n" || k === "N") setNotes(!notes);
    else if (k === "Escape") onClose(i);
    else return;
    e.preventDefault();
  };
  const slide = slides[i]!;
  const scene = slideScene(tidy(slide), { index: i, total: slides.length });
  return (
    <div ref={ref} className={`presenter${notes ? " with-notes" : ""}`} role="dialog" aria-modal="true" aria-label={t("Presentation", "Présentation", "Präsentation")} tabIndex={-1} onKeyDown={onKey}>
      <div className="presenter-stage">
        <div className="slide-frame">
          <SceneSvg scene={scene} onCite={onCite} />
        </div>
      </div>
      {notes ? (
        <section className="presenter-notes" aria-label={t("Speaker notes", "Notes de l'orateur", "Sprechernotizen")}>
          <p>{slide.notes || t("No notes for this slide.", "Pas de notes pour cette diapositive.", "Keine Notizen zu dieser Folie.")}</p>
        </section>
      ) : null}
      <div className="presenter-bar">
        <button type="button" className="icon-button" aria-label={t("Previous slide", "Diapositive précédente", "Vorherige Folie")} disabled={i === 0} onClick={() => go(i - 1)}>
          ←
        </button>
        <span className="presenter-count" aria-live="polite">
          {t(`Slide ${i + 1} of ${slides.length}`, `Diapositive ${i + 1} sur ${slides.length}`, `Folie ${i + 1} von ${slides.length}`)}
        </span>
        <button type="button" className="icon-button" aria-label={t("Next slide", "Diapositive suivante", "Nächste Folie")} disabled={i === slides.length - 1} onClick={() => go(i + 1)}>
          →
        </button>
        <button type="button" className="secondary" aria-pressed={notes} aria-keyshortcuts="N" onClick={() => setNotes(!notes)}>
          {t("Notes", "Notes", "Notizen")}
        </button>
        <button type="button" className="secondary" aria-keyshortcuts="Escape" onClick={() => onClose(i)}>
          <Icon name="x" size={18} /> {t("Leave", "Quitter", "Beenden")}
        </button>
      </div>
    </div>
  );
}

function View({ artifact, onChange }: ViewProps<SlidesData>) {
  const { t } = useLang();
  const data = artifact.data;
  const [draft, setDraft] = useState(data.slides);
  useEffect(() => {
    setDraft(data.slides);
  }, [data]);
  const [cur, setCur] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const presentButton = useRef<HTMLButtonElement>(null);
  const presented = useRef(false);
  useEffect(() => {
    // Back from presenting: focus returns to the button that started it, once the full screen is left.
    if (presenting) presented.current = true;
    else if (presented.current) {
      presented.current = false;
      presentButton.current?.focus();
    }
  }, [presenting]);
  const i = Math.min(cur, Math.max(0, draft.length - 1));
  const save = (next: Slide[]) => {
    const clean = next.map(tidy);
    setDraft(clean);
    onChange({ ...data, slides: clean });
  };
  const cite = (l: string) => openCitation(l, artifact.sourceIds);
  const tidied = useMemo(() => draft.map(tidy), [draft]);
  const scenes = useMemo(() => tidied.map((s, n) => slideScene(s, { index: n, total: tidied.length })), [tidied]);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.length) return;
    const next = [...draft];
    const [s] = next.splice(from, 1);
    next.splice(to, 0, s!);
    save(next);
    setCur(to);
  };
  const slide = draft[i];
  return (
    <div className="stack">
      <div className="row wrap no-print">
        <button type="button" ref={presentButton} className="primary" disabled={!draft.length} onClick={() => setPresenting(true)}>
          <Icon name="play" size={18} /> {t("Present", "Présenter", "Präsentieren")}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            save([...draft.slice(0, i + 1), { ...emptySlide("bullets"), title: t("New slide", "Nouvelle diapositive", "Neue Folie") }, ...draft.slice(i + 1)]);
            setCur(draft.length ? i + 1 : 0);
          }}
        >
          <Icon name="plus" size={18} /> {t("Add a slide", "Ajouter une diapositive", "Folie hinzufügen")}
        </button>
      </div>
      <div className="deck no-print">
        <ol className="deck-strip" aria-label={t("Slides", "Diapositives", "Folien")}>
          {scenes.map((sc, n) => (
            <li key={draft[n]!.id}>
              <button type="button" className="deck-thumb" aria-current={n === i ? "true" : undefined} onClick={() => setCur(n)} aria-label={t(`Slide ${n + 1}: ${sc.title}`, `Diapositive ${n + 1} : ${sc.title}`, `Folie ${n + 1}: ${sc.title}`)}>
                <span className="deck-num" aria-hidden="true">
                  {n + 1}
                </span>
                <span className="slide-frame" aria-hidden="true">
                  <SceneSvg scene={sc} />
                </span>
              </button>
            </li>
          ))}
        </ol>
        {slide ? (
          <div className="stack deck-main">
            <div className="slide-frame slide-big">
              <SceneSvg scene={scenes[i]!} onCite={cite} />
            </div>
            <div className="row wrap" role="group" aria-label={t(`Slide ${i + 1}`, `Diapositive ${i + 1}`, `Folie ${i + 1}`)}>
              <button type="button" className="secondary" disabled={i === 0} onClick={() => move(i, i - 1)}>
                ↑ {t("Move up", "Monter", "Nach oben")}
              </button>
              <button type="button" className="secondary" disabled={i === draft.length - 1} onClick={() => move(i, i + 1)}>
                ↓ {t("Move down", "Descendre", "Nach unten")}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  save(draft.filter((_, n) => n !== i));
                  setCur(Math.max(0, i - 1));
                }}
              >
                <Icon name="trash" size={18} /> {t("Delete the slide", "Supprimer la diapositive", "Folie löschen")}
              </button>
            </div>
            <SlideEditor
              key={slide.id}
              slide={slide}
              set={(s) => setDraft(draft.map((x, n) => (n === i ? s : x)))}
              save={(s) => save(s ? draft.map((x, n) => (n === i ? s : x)) : draft)}
            />
          </div>
        ) : (
          <p className="meta">{t("No slides yet.", "Aucune diapositive pour l'instant.", "Noch keine Folien.")}</p>
        )}
      </div>
      {/* Printed only: one slide a landscape page. */}
      <div className="slides-print print-area">
        {scenes.map((sc, n) => (
          <div key={draft[n]!.id} className="slide-frame slide-page">
            <SceneSvg scene={sc} />
          </div>
        ))}
      </div>
      {presenting && draft.length ? (
        <Presenter
          slides={draft}
          start={i}
          onCite={cite}
          onClose={(at) => {
            setPresenting(false);
            setCur(at);
          }}
        />
      ) : null}
    </div>
  );
}

const TOKENS_PER_SLIDE = 260;

export const slides = kind<SlidesData, SlidesOptions>({
  type: "slides",
  icon: "slides",
  label: (t) => t("Slides", "Diapositives", "Folien"),
  blurb: (t) => t("A deck with diagrams and speaker notes, to present or export to PowerPoint and PDF", "Une présentation avec schémas et notes, à projeter ou exporter en PowerPoint et PDF", "Ein Foliensatz mit Diagrammen und Notizen, zum Präsentieren oder als PowerPoint und PDF"),
  defaults: { count: 10, level: "course", focus: "" },
  Options,
  async generate(ctx, o) {
    ctx.progress({ label: "" });
    const context = buildContext(ctx.sources, { query: o.focus || undefined, budget: budgetFor(capabilities().contextWindow) });
    const answer = await askJson(SlidesAnswer, {
      system: `You make a slide deck of a university student's course from their own sources: about ${o.count} slides. ${LEVEL_PROMPT[o.level]} Open with a title slide and end with a recap. Pick for each slide the layout that suits it: "bullets" (3 to 5 short points, a few words each, never full paragraphs), "two-columns" (two things side by side), "quote" (a sentence the sources actually contain), "diagram" (steps of a process, a cycle, a comparison of 2 or 3 things, a hierarchy), "key-figure" (one number that matters, from the sources), "title" (the opening and section breaks). Vary the layouts; use diagrams and key figures where the material has them. Slide text is short; what to say goes in "notes" (three to six sentences for the presenter). Put in "cites" the labels of the passages a slide comes from, exactly as in the sources (e.g. "S1 p.3"); keep citation labels out of the slide text. Write in ${writeIn(ctx.language)}. ${CITE_RULE}`,
      prompt: `${o.focus ? `Focus on: ${o.focus}\n\n` : ""}${context.text}`,
      shape: SLIDES_SHAPE,
      maxOutputTokens: Math.max(4000, o.count * TOKENS_PER_SLIDE * 2),
      signal: ctx.signal,
    });
    return { title: answer.title, data: { slides: answer.slides } };
  },
  View,
  exports: [
    {
      id: "pptx",
      label: (t) => t("PowerPoint (.pptx)", "PowerPoint (.pptx)", "PowerPoint (.pptx)"),
      run: async (a) => ({
        blob: new Blob([(await buildPptx(a.title, a.data.slides.map(tidy), { language: a.language })) as Uint8Array<ArrayBuffer>], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }),
        filename: `${slug(a.title)}.pptx`,
      }),
    },
    {
      id: "pdf",
      label: (t) => t("PDF (print)", "PDF (impression)", "PDF (Drucken)"),
      run: async () => {
        window.print();
      },
    },
    {
      id: "md",
      label: (t) => t("Outline and notes (Markdown)", "Plan et notes (Markdown)", "Gliederung und Notizen (Markdown)"),
      run: async (a) => ({ blob: new Blob([slidesMarkdown(a.title, a.data.slides.map(tidy))], { type: "text/markdown" }), filename: `${slug(a.title)}.md` }),
    },
  ],
});
