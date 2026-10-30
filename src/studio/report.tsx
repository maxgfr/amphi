// Reports: a written piece made from the sources, cited passage by passage:
// a summary, a study guide, a briefing, a FAQ, an essay plan, a comparison
// of lessons or a glossary. Exported as Markdown or printed to PDF.

import { useState } from "react";
import { budgetFor, buildContext, CITE_RULE } from "../ai/context.ts";
import { ask, capabilities, writeIn } from "../ai/llm.ts";
import { type T, trIn, useLang } from "../i18n.ts";
import { Icon } from "../ui/icons.tsx";
import { openCitation } from "../ui/cite.ts";
import { Field, slug } from "../ui/kit.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { kind, type OptionsProps, type ViewProps } from "./types.ts";

export const REPORT_FORMATS = ["summary", "study-guide", "briefing", "faq", "essay-plan", "comparison", "glossary"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
export type Length = "short" | "medium" | "long";

export interface ReportOptions extends Record<string, unknown> {
  format: ReportFormat;
  length: Length;
  /** What to focus on, in the student's words. */
  focus: string;
}

export interface ReportData {
  format: ReportFormat;
  markdown: string;
}

export const formatLabel = (f: ReportFormat, t: T): string =>
  ({
    summary: t("Summary", "Résumé", "Zusammenfassung"),
    "study-guide": t("Study guide", "Guide de révision", "Lernleitfaden"),
    briefing: t("Briefing", "Note de synthèse", "Briefing"),
    faq: t("FAQ", "FAQ", "FAQ"),
    "essay-plan": t("Essay plan", "Plan de dissertation", "Gliederung für einen Aufsatz"),
    comparison: t("Comparison", "Comparaison", "Vergleich"),
    glossary: t("Glossary", "Glossaire", "Glossar"),
  })[f];

const INSTRUCTIONS: Record<ReportFormat, string> = {
  summary: "Write a summary: two or three sentences on what it is about, then the key ideas as sections with short paragraphs and lists.",
  "study-guide":
    "Write a study guide for an exam: the key concepts with a clear explanation each, the definitions to know, the formulas or dates if any, the classic pitfalls, and ten review questions with short answers at the end.",
  briefing: "Write a briefing document: an executive summary, then the main themes, the important facts and figures, and the open questions.",
  faq: "Write a FAQ: the 10 to 15 questions a student would ask about this material, each with a precise answer.",
  "essay-plan": "Write a detailed essay plan: a problem statement, an introduction, two or three parts with sub-parts and the arguments and examples from the sources for each, and a conclusion.",
  comparison: "Compare the sources (lessons, documents) with each other: what they share, where they differ, how they build on each other, as sections and a comparison table.",
  glossary: "Write a glossary: every technical term of the material, in alphabetical order, each with a one or two sentence definition.",
};

const WORDS: Record<Length, string> = { short: "about 300 words", medium: "about 800 words", long: "about 1800 words" };

function Options({ value, onChange }: OptionsProps<ReportOptions>) {
  const { t } = useLang();
  return (
    <div className="stack">
      <Field label={t("Kind of report", "Type de rapport", "Art des Berichts")}>
        <select value={value.format} onChange={(e) => onChange({ ...value, format: e.currentTarget.value as ReportFormat })}>
          {REPORT_FORMATS.map((f) => (
            <option key={f} value={f}>
              {formatLabel(f, t)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("Length", "Longueur", "Länge")}>
        <select value={value.length} onChange={(e) => onChange({ ...value, length: e.currentTarget.value as Length })}>
          <option value="short">{t("Short", "Court", "Kurz")}</option>
          <option value="medium">{t("Medium", "Moyen", "Mittel")}</option>
          <option value="long">{t("Long", "Long", "Lang")}</option>
        </select>
      </Field>
      <Field label={t("Focus (optional)", "Angle (facultatif)", "Schwerpunkt (optional)")}>
        <input value={value.focus} onChange={(e) => onChange({ ...value, focus: e.currentTarget.value })} placeholder={t("e.g. chapter 3, the definitions", "ex. le chapitre 3, les définitions", "z. B. Kapitel 3, die Definitionen")} />
      </Field>
    </div>
  );
}

function View({ artifact, onChange }: ViewProps<ReportData>) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(artifact.data.markdown);
  if (editing)
    return (
      <div className="stack">
        <textarea rows={24} value={text} onChange={(e) => setText(e.currentTarget.value)} aria-label={t("Report", "Rapport", "Bericht")} />
        <div className="row end">
          <button type="button" className="secondary" onClick={() => setEditing(false)}>
            {t("Cancel", "Annuler", "Abbrechen")}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onChange({ ...artifact.data, markdown: text });
              setEditing(false);
            }}
          >
            {t("Save", "Enregistrer", "Speichern")}
          </button>
        </div>
      </div>
    );
  return (
    <div className="stack">
      <div className="row no-print">
        <button type="button" className="secondary" onClick={() => setEditing(true)}>
          <Icon name="edit" size={18} /> {t("Edit", "Modifier", "Bearbeiten")}
        </button>
      </div>
      <article className="print-area">
        <Markdown text={artifact.data.markdown} onCite={(l) => openCitation(l, artifact.sourceIds)} />
      </article>
    </div>
  );
}

export const report = kind<ReportData, ReportOptions>({
  type: "report",
  icon: "report",
  label: (t) => t("Reports", "Rapports", "Berichte"),
  blurb: (t) => t("Summary, study guide, briefing, FAQ, essay plan, glossary", "Résumé, guide de révision, synthèse, FAQ, plan, glossaire", "Zusammenfassung, Lernleitfaden, Briefing, FAQ, Gliederung, Glossar"),
  defaults: { format: "summary", length: "medium", focus: "" },
  Options,
  async generate(ctx, o) {
    ctx.progress({ label: "" });
    const context = buildContext(ctx.sources, { query: o.focus || undefined, budget: budgetFor(capabilities().contextWindow) });
    const { text } = await ask({
      system: `You write study material for a university student from their own course sources. ${INSTRUCTIONS[o.format]} Length: ${WORDS[o.length]}. Write in ${writeIn(ctx.language)}. Markdown with ## headings; no title line. ${CITE_RULE}`,
      prompt: `${o.focus ? `Focus on: ${o.focus}\n\n` : ""}${context.text}`,
      signal: ctx.signal,
    });
    const title = `${formatLabel(o.format, trIn(ctx.language))} · ${ctx.lesson?.title ?? ctx.course.title}`;
    return { title, data: { format: o.format, markdown: text.trim() } };
  },
  View,
  exports: [
    {
      id: "md",
      label: (t) => t("Markdown", "Markdown", "Markdown"),
      run: async (a) => ({ blob: new Blob([`# ${a.title}\n\n${a.data.markdown}\n`], { type: "text/markdown" }), filename: `${slug(a.title)}.md` }),
    },
    {
      id: "pdf",
      label: (t) => t("PDF (print)", "PDF (impression)", "PDF (Drucken)"),
      run: async () => {
        window.print();
      },
    },
  ],
});
