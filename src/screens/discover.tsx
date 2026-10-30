// Discover a new topic: what, at which level, for what; the provider's web
// search maps it and proposes sources (src/learn/discover.ts), the student
// keeps the ones they want, and the topic is created with its concepts, its
// notes and a mind map.

import { useEffect, useRef, useState } from "react";
import { loadLlm, recipient, savedSettings } from "../ai/llm.ts";
import { useLive } from "../data/hooks.ts";
import { count, languageLabel, useLang } from "../i18n.ts";
import { canSearch, createTopic, type DiscoverInput, discoverTopic, type Goal, type Level, type Proposal, type TopicMap } from "../learn/discover.ts";
import { go, href } from "../router.ts";
import { Icon } from "../ui/icons.tsx";
import { Field, Notice } from "../ui/kit.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { MATERIAL_LANGS } from "./course-form.tsx";

export function Discover() {
  const { t, lang } = useLang();
  const [input, setInput] = useState<DiscoverInput>({ topic: "", level: "beginner", goal: "general", language: lang });
  const [map, setMap] = useState<TopicMap | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<"" | "mapping" | "creating">("");
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const ai = useLive(
    async () => {
      await loadLlm();
      const configured = Boolean(savedSettings());
      return { configured, web: configured && canSearch(), to: recipient() };
    },
    [],
    [],
  );
  if (!ai) return <div className="page" aria-busy="true" />;

  const run = async () => {
    setError("");
    setBusy("mapping");
    abort.current = new AbortController();
    try {
      const m = await discoverTopic(input, { signal: abort.current.signal });
      setMap(m);
      setChosen(new Set(m.proposals.flatMap((p, i) => (p.suggested ? [i] : []))));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const create = async () => {
    if (!map) return;
    setError("");
    setBusy("creating");
    try {
      const course = await createTopic(
        input,
        map,
        map.proposals.filter((_, i) => chosen.has(i)),
      );
      go(href.course(course.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  };

  const set = <K extends keyof DiscoverInput>(k: K, v: DiscoverInput[K]) => {
    setInput((x) => ({ ...x, [k]: v }));
    setMap(null);
  };

  return (
    <div className="page discover">
      <h1>{t("Discover a topic", "Découvrir un sujet", "Ein Thema entdecken")}</h1>
      <p className="lead">
        {t(
          "Something to learn outside your courses: get a map of its concepts in the order to learn them, and sources to start with.",
          "Quelque chose à apprendre en dehors de vos cours : obtenez la carte de ses notions dans l'ordre où les apprendre, et des sources pour commencer.",
          "Etwas außerhalb Ihrer Kurse lernen: Erhalten Sie eine Karte seiner Begriffe in der Lernreihenfolge und Quellen für den Einstieg.",
        )}
      </p>
      {!ai.configured ? (
        <Notice>
          {t("Discover uses your own AI provider.", "Découvrir utilise votre propre fournisseur d'IA.", "Entdecken nutzt Ihren eigenen KI-Anbieter.")} <a href={href.settings("ai")}>{t("Set one up", "En configurer un", "Einen einrichten")}</a>
        </Notice>
      ) : null}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Field label={t("Topic", "Sujet", "Thema")}>
          <input value={input.topic} required onChange={(e) => set("topic", e.currentTarget.value)} placeholder={t("e.g. Thermodynamics, Roman history, linear algebra", "ex. thermodynamique, histoire romaine, algèbre linéaire", "z. B. Thermodynamik, römische Geschichte, lineare Algebra")} />
        </Field>
        <div className="grid discover-options">
          <Field label={t("Your level", "Votre niveau", "Ihr Niveau")}>
            <select value={input.level} onChange={(e) => set("level", e.currentTarget.value as Level)}>
              <option value="beginner">{t("Beginner", "Débutant", "Anfänger")}</option>
              <option value="intermediate">{t("Intermediate", "Intermédiaire", "Fortgeschritten")}</option>
              <option value="advanced">{t("Advanced", "Avancé", "Experte")}</option>
            </select>
          </Field>
          <Field label={t("Your goal", "Votre objectif", "Ihr Ziel")}>
            <select value={input.goal} onChange={(e) => set("goal", e.currentTarget.value as Goal)}>
              <option value="exam">{t("Pass an exam", "Réussir un examen", "Eine Prüfung bestehen")}</option>
              <option value="general">{t("General knowledge", "Culture générale", "Allgemeinwissen")}</option>
              <option value="project">{t("A project", "Un projet", "Ein Projekt")}</option>
            </select>
          </Field>
          <Field label={t("Language", "Langue", "Sprache")}>
            <select value={input.language} onChange={(e) => set("language", e.currentTarget.value)}>
              {MATERIAL_LANGS.map((l) => (
                <option key={l} value={l}>
                  {languageLabel(l)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {ai.configured ? (
          ai.web ? (
            <Notice>
              {t(
                `Your topic, level and goal are sent to ${ai.to}, which searches the web with its own search tool.`,
                `Votre sujet, niveau et objectif sont envoyés à ${ai.to}, qui cherche sur le web avec son propre outil de recherche.`,
                `Ihr Thema, Niveau und Ziel werden an ${ai.to} gesendet, das mit seinem eigenen Suchwerkzeug im Web sucht.`,
              )}
            </Notice>
          ) : (
            <Notice>
              {t(
                `Your topic, level and goal are sent to ${ai.to}. This model cannot search the web: the plan comes from its own knowledge, and its reading suggestions are unsourced, to verify. A model with web search (Claude, GPT, Gemini) finds real sources.`,
                `Votre sujet, niveau et objectif sont envoyés à ${ai.to}. Ce modèle ne peut pas chercher sur le web : le plan vient de ses propres connaissances, et ses suggestions de lecture sont non sourcées, à vérifier. Un modèle avec recherche web (Claude, GPT, Gemini) trouve de vraies sources.`,
                `Ihr Thema, Niveau und Ziel werden an ${ai.to} gesendet. Dieses Modell kann nicht im Web suchen: Der Plan stammt aus seinem eigenen Wissen, seine Lesevorschläge sind ohne Quelle und zu prüfen. Ein Modell mit Websuche (Claude, GPT, Gemini) findet echte Quellen.`,
              )}
            </Notice>
          )
        ) : null}
        <div className="row">
          {busy === "mapping" ? (
            <button type="button" className="secondary" onClick={() => abort.current?.abort()}>
              <Icon name="stop" size={18} /> {t("Stop", "Arrêter", "Stopp")}
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!ai.configured || !input.topic.trim() || busy !== ""}>
              <Icon name="compass" size={18} /> {map ? t("Map it again", "Refaire la carte", "Neu kartieren") : t("Map the topic", "Cartographier le sujet", "Thema kartieren")}
            </button>
          )}
          {busy === "mapping" ? (
            <span className="meta" role="status">
              {ai.web ? t("Searching the web and mapping the topic…", "Recherche sur le web et carte du sujet…", "Websuche und Kartierung des Themas…") : t("Mapping the topic…", "Carte du sujet en cours…", "Thema wird kartiert…")}
            </span>
          ) : null}
        </div>
      </form>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {map ? <Result map={map} chosen={chosen} setChosen={setChosen} creating={busy === "creating"} onCreate={() => void create()} /> : null}
    </div>
  );
}

function Result({ map, chosen, setChosen, creating, onCreate }: { map: TopicMap; chosen: Set<number>; setChosen: (s: Set<number>) => void; creating: boolean; onCreate: () => void }) {
  const { t } = useLang();
  const titleOf = new Map(map.concepts.map((c) => [c.title.toLowerCase(), c.title]));
  return (
    <section className="stack discover-result" aria-labelledby="discover-map">
      <h2 id="discover-map">{map.title}</h2>
      {map.overview ? <p className="lead">{map.overview}</p> : null}
      <h3 className="section-title">{t("Concepts, in the order to learn them", "Notions, dans l'ordre où les apprendre", "Begriffe in der Lernreihenfolge")}</h3>
      <ol className="discover-concepts">
        {map.concepts.map((c) => (
          <li key={c.title}>
            <strong>{c.title}</strong>
            {c.prerequisites?.length ? (
              <span className="meta">
                {" "}
                · {t("after", "après", "nach")} {c.prerequisites.map((p) => titleOf.get(p.toLowerCase()) ?? p).join(", ")}
              </span>
            ) : null}
            {c.summary ? <p className="meta">{c.summary}</p> : null}
          </li>
        ))}
      </ol>
      <fieldset className="proposals">
        <legend>{map.web ? t("Sources found on the web", "Sources trouvées sur le web", "Im Web gefundene Quellen") : t("Reading suggestions (unsourced, to verify)", "Suggestions de lecture (non sourcées, à vérifier)", "Lesevorschläge (ohne Quelle, zu prüfen)")}</legend>
        {map.web ? (
          <p className="meta">
            {t(
              "Ticked ones become notes of the topic, with their link and what the search said about them. amphi does not open these pages itself (a web page cannot read other sites): open them, then paste what matters or drop the PDF into the topic.",
              "Celles cochées deviennent des notes du sujet, avec leur lien et ce que la recherche en a dit. amphi n'ouvre pas ces pages lui-même (une page web ne peut pas lire d'autres sites) : ouvrez-les, puis collez ce qui compte ou déposez le PDF dans le sujet.",
              "Angehakte werden zu Notizen des Themas, mit ihrem Link und dem, was die Suche über sie sagte. amphi öffnet diese Seiten nicht selbst (eine Webseite kann andere Websites nicht lesen): Öffnen Sie sie und fügen Sie das Wichtige ein oder legen Sie das PDF im Thema ab.",
            )}
          </p>
        ) : (
          <p className="meta">
            {t(
              "Without a web search these come from the model's memory: no link is given, look them up yourself. Ticked ones become notes marked as unsourced.",
              "Sans recherche web, elles viennent de la mémoire du modèle : aucun lien n'est donné, cherchez-les vous-même. Celles cochées deviennent des notes marquées non sourcées.",
              "Ohne Websuche stammen sie aus dem Gedächtnis des Modells: Es gibt keinen Link, suchen Sie sie selbst. Angehakte werden zu als ohne Quelle markierten Notizen.",
            )}
          </p>
        )}
        {map.proposals.length ? (
          <ul className="proposal-list">
            {map.proposals.map((p, i) => (
              <ProposalItem
                key={`${p.url ?? ""}${p.title}`}
                p={p}
                checked={chosen.has(i)}
                onChange={(on) => {
                  const next = new Set(chosen);
                  if (on) next.add(i);
                  else next.delete(i);
                  setChosen(next);
                }}
              />
            ))}
          </ul>
        ) : (
          <p className="meta">{t("No source was proposed.", "Aucune source proposée.", "Keine Quelle vorgeschlagen.")}</p>
        )}
      </fieldset>
      <p className="meta">
        {t(
          `Creates the topic with ${count(map.concepts.length, ["concept", "concepts"], ["notion", "notions"], ["Begriff", "Begriffen"])}, ${count(chosen.size, ["note", "notes"], ["note", "notes"], ["Notiz", "Notizen"])} and a mind map. Nothing more is sent.`,
          `Crée le sujet avec ${count(map.concepts.length, ["concept", "concepts"], ["notion", "notions"], ["Begriff", "Begriffen"])}, ${count(chosen.size, ["note", "notes"], ["note", "notes"], ["Notiz", "Notizen"])} et une carte mentale. Rien d'autre n'est envoyé.`,
          `Erstellt das Thema mit ${count(map.concepts.length, ["concept", "concepts"], ["notion", "notions"], ["Begriff", "Begriffen"])}, ${count(chosen.size, ["note", "notes"], ["note", "notes"], ["Notiz", "Notizen"])} und einer Mindmap. Nichts weiter wird gesendet.`,
        )}
      </p>
      <div className="row">
        <button type="button" className="primary" disabled={creating} onClick={onCreate}>
          <Icon name="plus" size={18} /> {t("Create the topic", "Créer le sujet", "Thema erstellen")}
        </button>
      </div>
    </section>
  );
}

function ProposalItem({ p, checked, onChange }: { p: Proposal; checked: boolean; onChange: (on: boolean) => void }) {
  const { t } = useLang();
  return (
    <li className="proposal">
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
        <span className="list-title">{p.title}</span>
        {p.level ? <span className="meta">· {p.level}</span> : null}
      </label>
      <div className="proposal-body">
        {p.url ? (
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="proposal-url">
            {p.url}
          </a>
        ) : null}
        {p.status === "unlisted" ? <p className="hint">{t("Not among the search results: check this link before relying on it.", "Absent des résultats de recherche : vérifiez ce lien avant de vous y fier.", "Nicht unter den Suchergebnissen: Prüfen Sie diesen Link, bevor Sie sich darauf verlassen.")}</p> : null}
        {p.status === "unsourced" ? <p className="hint">{t("Unsourced, to verify", "Non sourcé, à vérifier", "Ohne Quelle, zu prüfen")}</p> : null}
        {p.why ? <p className="meta">{p.why}</p> : null}
        {p.excerpt ? (
          <div className="proposal-excerpt">
            <Markdown text={p.excerpt} />
          </div>
        ) : null}
      </div>
    </li>
  );
}
