// Infographics: the key figures, dates, steps, comparisons, hierarchies and
// definitions of the sources as one tall themed image, composed by our own
// components from the model's text (no SVG or HTML from the model ever
// reaches the page), with a text version, exported as SVG or PNG.

import { useMemo, useState } from "react";
import { budgetFor, buildContext } from "../ai/context.ts";
import { capabilities, writeIn } from "../ai/llm.ts";
import { askJson } from "../ai/structured.ts";
import { trIn, useLang } from "../i18n.ts";
import { openCitation } from "../ui/cite.ts";
import { Field, slug } from "../ui/kit.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { InfographicAnswer, type InfographicData, infographicScene, infographicText, SHAPE } from "./render/infographic-layout.ts";
import { SceneSvg } from "./render/scene.tsx";
import { pngBlob, svgBlob } from "./render/svg.ts";
import { kind, type OptionsProps, type ViewProps } from "./types.ts";

export interface InfographicOptions extends Record<string, unknown> {
  blocks: "few" | "many";
  focus: string;
}

function Options({ value, onChange }: OptionsProps<InfographicOptions>) {
  const { t } = useLang();
  return (
    <div className="stack">
      <Field label={t("Size", "Taille", "Umfang")}>
        <select value={value.blocks} onChange={(e) => onChange({ ...value, blocks: e.currentTarget.value as InfographicOptions["blocks"] })}>
          <option value="few">{t("Essential (3 or 4 blocks)", "L'essentiel (3 ou 4 blocs)", "Das Wesentliche (3 oder 4 Blöcke)")}</option>
          <option value="many">{t("Complete (5 to 7 blocks)", "Complet (5 à 7 blocs)", "Vollständig (5 bis 7 Blöcke)")}</option>
        </select>
      </Field>
      <Field label={t("Focus (optional)", "Angle (facultatif)", "Schwerpunkt (optional)")}>
        <input value={value.focus} onChange={(e) => onChange({ ...value, focus: e.currentTarget.value })} placeholder={t("e.g. the key dates, the figures", "ex. les dates clés, les chiffres", "z. B. die wichtigen Daten, die Zahlen")} />
      </Field>
    </div>
  );
}

function View({ artifact }: ViewProps<InfographicData>) {
  const { t } = useLang();
  const [asText, setAsText] = useState(false);
  const scene = useMemo(() => infographicScene(artifact.data), [artifact.data]);
  const cite = (l: string) => openCitation(l, artifact.sourceIds);
  return (
    <div className="stack">
      <div className="row no-print">
        <div className="segmented small" role="group" aria-label={t("Show as", "Afficher en", "Anzeigen als")}>
          <button type="button" aria-pressed={!asText} onClick={() => setAsText(false)}>
            {t("Image", "Image", "Bild")}
          </button>
          <button type="button" aria-pressed={asText} onClick={() => setAsText(true)}>
            {t("Text", "Texte", "Text")}
          </button>
        </div>
      </div>
      {asText ? (
        // The labels are the model's text, not markup.
        <Markdown text={infographicText(artifact.data).replace(/</g, "&lt;")} onCite={cite} />
      ) : (
        <div className="infographic print-area">
          <SceneSvg scene={scene} onCite={cite} />
        </div>
      )}
    </div>
  );
}

export const infographic = kind<InfographicData, InfographicOptions>({
  type: "infographic",
  icon: "chart",
  label: (t) => t("Infographic", "Infographie", "Infografik"),
  blurb: (t) => t("Key figures, timeline, steps, comparison, definitions on one page", "Chiffres clés, frise, étapes, comparaison, définitions sur une page", "Kennzahlen, Zeitleiste, Schritte, Vergleich, Definitionen auf einer Seite"),
  defaults: { blocks: "few", focus: "" },
  Options,
  async generate(ctx, o) {
    ctx.progress({ label: "" });
    const context = buildContext(ctx.sources, { query: o.focus || undefined, budget: budgetFor(capabilities().contextWindow) });
    const data = await askJson(InfographicAnswer, {
      system: `You design an infographic of a university student's course material from their own sources: a title, a one-line subtitle, then ${o.blocks === "few" ? "3 or 4" : "5 to 7"} blocks, each of the type that suits the material best (key figures for numbers that matter, a timeline for dates, steps for a process, a comparison table for things side by side, a hierarchy for a classification, definitions for terms). Give each block a short title. Texts are short: a label is a few words, a step or a definition one sentence. Every item that states a fact has "cite": the label of its passage, exactly as in the sources (e.g. "S1 p.3", "S2 12:34", "S3 §2"). Use only what the sources say; never make up a figure. Write in ${writeIn(ctx.language)}.`,
      prompt: `${o.focus ? `Focus on: ${o.focus}\n\n` : ""}${context.text}`,
      shape: SHAPE,
      signal: ctx.signal,
    });
    const l = trIn(ctx.language);
    return { title: `${l("Infographic", "Infographie", "Infografik")} · ${ctx.lesson?.title ?? ctx.course.title}`, data };
  },
  View,
  exports: [
    {
      id: "svg",
      label: (t) => t("SVG image", "Image SVG", "SVG-Bild"),
      run: async (a) => ({ blob: svgBlob(infographicScene(a.data)), filename: `${slug(a.title)}.svg` }),
    },
    {
      id: "png",
      label: (t) => t("PNG image", "Image PNG", "PNG-Bild"),
      run: async (a) => ({ blob: await pngBlob(infographicScene(a.data)), filename: `${slug(a.title)}.png` }),
    },
  ],
});
