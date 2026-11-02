// Discover: the student brings a topic, a question, a book or a link, or a
// skill, and says where it goes (a new topic or a course they have); or digs
// into one concept of a course, or looks for new sources for it. The
// provider's web search maps it and proposes sources (src/learn/discover.ts),
// the student keeps what they want. Until then everything is kept as a draft
// on this device, so a reload does not throw away a map already paid for. The
// same flow sits in Today (DiscoverSection) and on its own screen, where
// links from a course land (Discover).

import { useEffect, useRef, useState } from "react";
import { loadLlm, recipient, savedSettings } from "../ai/llm.ts";
import { list } from "../data/db.ts";
import { useLive } from "../data/hooks.ts";
import type { Course } from "../data/schema.ts";
import { clock, count, languageLabel, type T, useLang } from "../i18n.ts";
import { dismissSuggestion, loadSuggestions, type Suggestion, type SuggestionKind, suggestTopics } from "../learn/suggest.ts";
import { applyDiscovery, canSearch, clearDraft, type DiscoverContext, type DiscoverInput, type DiscoverTarget, type Intent, intentOf, type Level, loadDiscoverContext, loadDraft, type Proposal, SEED_KINDS, type SeedKind, saveDraft, type TopicMap } from "../learn/discover.ts";
import { adoptJob, chooseInJob, type DiscoverJob, getJob, isActive, removeJob, retryJob, sameTarget, startJob, useDiscoverJobs, allJobs } from "../learn/discover-jobs.ts";
import { go, href } from "../router.ts";
import { courseHue } from "../ui/hue.ts";
import { Icon } from "../ui/icons.tsx";
import { Empty, Field, Notice, Segmented } from "../ui/kit.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { MATERIAL_LANGS } from "./course-form.tsx";

function seedText(kind: SeedKind, t: T) {
  switch (kind) {
    case "topic":
      return { tab: t("A topic", "Un sujet", "Ein Thema"), label: t("Topic", "Sujet", "Thema"), what: t("Your topic", "Votre sujet", "Ihr Thema"), placeholder: t("e.g. Thermodynamics, Roman history, linear algebra", "ex. thermodynamique, histoire romaine, algèbre linéaire", "z. B. Thermodynamik, römische Geschichte, lineare Algebra") };
    case "question":
      return { tab: t("A question", "Une question", "Eine Frage"), label: t("Your question", "Votre question", "Ihre Frage"), what: t("Your question", "Votre question", "Ihre Frage"), placeholder: t("e.g. Why does ice float?", "ex. Pourquoi la glace flotte-t-elle ?", "z. B. Warum schwimmt Eis?") };
    case "work":
      return { tab: t("A book or a link", "Un livre ou un lien", "Ein Buch oder Link"), label: t("Title or link", "Titre ou lien", "Titel oder Link"), what: t("The work you named", "L'œuvre indiquée", "Das genannte Werk"), placeholder: t("e.g. The Wealth of Nations, or a page's address", "ex. Les Misérables, ou l'adresse d'une page", "z. B. Der Wohlstand der Nationen, oder eine Adresse") };
    case "skill":
      return { tab: t("A skill", "Une compétence", "Eine Fähigkeit"), label: t("Skill", "Compétence", "Fähigkeit"), what: t("The skill", "La compétence", "Die Fähigkeit"), placeholder: t("e.g. Public speaking, SQL, sight-reading", "ex. prise de parole, SQL, déchiffrage", "z. B. freie Rede, SQL, Vom-Blatt-Spiel") };
  }
}

/** The screen: a new topic, or what a course sent here (a concept to dig into, new sources, more to add). */
export function Discover({ target = {} }: { target?: DiscoverTarget }) {
  const { t } = useLang();
  const intent = intentOf(target);
  const ctx = useLive(() => loadDiscoverContext(target), ["courses", "concepts", "sources"], [target.courseId, target.conceptId]);
  if (ctx === undefined) return <div className="page" aria-busy="true" />;
  if (intent !== "map" && (!ctx.course || (intent === "dig" && !ctx.concept)))
    return (
      <div className="page">
        <Empty icon="compass" title={t("This course or concept no longer exists.", "Ce cours ou cette notion n'existe plus.", "Dieser Kurs oder Begriff existiert nicht mehr.")}>
          <a href={href.courses()}>{t("Back to courses", "Retour aux cours", "Zurück zu den Kursen")}</a>
        </Empty>
      </div>
    );
  const course = ctx.course;
  const title = course?.title ?? "";
  const head: Record<Intent, { h1: string; lead: string }> = {
    map: {
      h1: t("Discover a topic", "Découvrir un sujet", "Ein Thema entdecken"),
      lead: t(
        "Something to learn outside your courses: get a map of its concepts in the order to learn them, and sources to start with.",
        "Quelque chose à apprendre en dehors de vos cours : obtenez la carte de ses notions dans l'ordre où les apprendre, et des sources pour commencer.",
        "Etwas außerhalb Ihrer Kurse lernen: Erhalten Sie eine Karte seiner Begriffe in der Lernreihenfolge und Quellen für den Einstieg.",
      ),
    },
    extend: {
      h1: t(`Add to “${title}”`, `Ajouter à « ${title} »`, `Zu „${title}“ hinzufügen`),
      lead: t("A topic, a question, a book or a skill, mapped into this course: the concepts it lacks and sources to read.", "Un sujet, une question, un livre ou une compétence, cartographié dans ce cours : les notions qui lui manquent et des sources à lire.", "Ein Thema, eine Frage, ein Buch oder eine Fähigkeit, in diesen Kurs eingeordnet: die fehlenden Begriffe und Quellen zum Lesen."),
    },
    dig: {
      h1: t(`Dig into “${ctx.concept?.title ?? ""}”`, `Creuser « ${ctx.concept?.title ?? ""} »`, `„${ctx.concept?.title ?? ""}“ vertiefen`),
      lead: t("A deeper explanation, the sub-concepts it breaks into, and sources about it alone.", "Une explication plus poussée, les sous-notions qui la composent, et des sources sur elle seule.", "Eine tiefere Erklärung, die Unterbegriffe, aus denen er besteht, und Quellen nur dazu."),
    },
    refresh: {
      h1: t(`New sources for “${title}”`, `De nouvelles sources pour « ${title} »`, `Neue Quellen für „${title}“`),
      lead: t("A new web search for this topic: pages it does not have yet, and concepts it misses.", "Une nouvelle recherche web pour ce sujet : des pages qu'il n'a pas encore, et les notions qui lui manquent.", "Eine neue Websuche zu diesem Thema: Seiten, die es noch nicht hat, und fehlende Begriffe."),
    },
  };
  return (
    <div className="page discover" data-hue={course ? courseHue(course) : undefined}>
      <header className="divider">
        {course ? (
          <nav className="crumbs" aria-label={t("Breadcrumb", "Fil d'Ariane", "Brotkrumen")}>
            <a href={href.course(course.id, intent === "dig" ? "progress" : "sources")}>{course.title}</a>
          </nav>
        ) : null}
        <h1>{head[intent].h1}</h1>
        <p className="divider-lead">{head[intent].lead}</p>
      </header>
      <RouteFlow target={target} ctx={ctx} />
    </div>
  );
}

/** The job a place shows first: the one its draft had open, an older draft's map, or (from a course) its latest. */
function initialOpen(target: DiscoverTarget, latest: boolean): string | undefined {
  const d = loadDraft(target);
  if (d?.open && getJob(d.open)) return d.open;
  if (d?.map) return adoptJob(d.input, target, d.map, d.chosen, d.concepts);
  return latest ? allJobs().findLast((j) => sameTarget(j.target, target))?.id : undefined;
}

function RouteFlow({ target, ctx }: { target: DiscoverTarget; ctx: DiscoverContext }) {
  const [open, setOpen] = useState(() => initialOpen(target, intentOf(target) !== "map"));
  return <DiscoverFlow target={target} ctx={ctx} open={open} onOpen={setOpen} />;
}

/** Discover, on Today: one line to start, the rest under Options, the maps on their way, and topics suggested from the courses. */
export function DiscoverSection() {
  const { t } = useLang();
  const [open, setOpen] = useState(() => initialOpen({}, false));
  const flow = useRef<HTMLDivElement>(null);
  const show = (id: string) => {
    setOpen(id);
    flow.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <section className="discover-today" aria-labelledby="discover-today">
      <h2 className="section-title" id="discover-today">
        {t("Discover", "Découvrir", "Entdecken")}
      </h2>
      <p className="meta">{t("Something to learn, a question, a book, a skill: amphi maps it, finds sources and makes it a topic, or adds it to a course.", "Un sujet, une question, un livre, une compétence : amphi le cartographie, trouve des sources et en fait un sujet, ou l'ajoute à un cours.", "Ein Thema, eine Frage, ein Buch, eine Fähigkeit: amphi kartiert es, findet Quellen und macht ein Thema daraus oder fügt es einem Kurs hinzu.")}</p>
      <div ref={flow}>
        <DiscoverFlow target={{}} compact open={open} onOpen={setOpen} />
      </div>
      <JobList open={open} onShow={show} />
      <Suggestions onShow={show} />
    </section>
  );
}

/** Seconds since `from`, ticking while `on`. */
function useElapsed(on: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

function jobStatus(j: DiscoverJob, now: number, t: T): string {
  const took = clock(Math.max(0, Math.round(((j.finishedAt ?? now) - j.startedAt) / 1000)));
  switch (j.status) {
    case "queued":
      return t("Waiting for a free slot (three maps at a time)", "En attente d'une place (trois cartes à la fois)", "Wartet auf einen freien Platz (drei Karten gleichzeitig)");
    case "searching":
      return `${t("Searching the web…", "Recherche sur le web…", "Websuche…")} ${took}`;
    case "mapping":
      return `${t("Making the map…", "Mise en forme de la carte…", "Karte wird erstellt…")} ${took}`;
    case "ready":
      return t(
        `Ready · ${count(j.map?.concepts.length ?? 0, ["concept", "concepts"], ["notion", "notions"], ["Begriff", "Begriffe"])}, ${count(j.map?.proposals.length ?? 0, ["source", "sources"], ["source", "sources"], ["Quelle", "Quellen"])} · ${took}`,
        `Prête · ${count(j.map?.concepts.length ?? 0, ["concept", "concepts"], ["notion", "notions"], ["Begriff", "Begriffe"])}, ${count(j.map?.proposals.length ?? 0, ["source", "sources"], ["source", "sources"], ["Quelle", "Quellen"])} · ${took}`,
        `Fertig · ${count(j.map?.concepts.length ?? 0, ["concept", "concepts"], ["notion", "notions"], ["Begriff", "Begriffe"])}, ${count(j.map?.proposals.length ?? 0, ["source", "sources"], ["source", "sources"], ["Quelle", "Quellen"])} · ${took}`,
      );
    case "error":
      return j.error ?? t("Failed", "Échec", "Fehlgeschlagen");
    case "interrupted":
      return t("Cut short by a reload", "Interrompue par un rechargement", "Durch Neuladen abgebrochen");
  }
}

/** Every map made or on its way, here or from a course, each with where it is. */
function JobList({ open, onShow }: { open?: string; onShow: (id: string) => void }) {
  const { t } = useLang();
  const jobs = useDiscoverJobs();
  const now = useElapsed(jobs.some(isActive));
  if (!jobs.length) return null;
  return (
    <div className="discover-jobs" aria-labelledby="discover-jobs">
      <h3 className="section-title" id="discover-jobs">
        {t("Your maps", "Vos cartes", "Ihre Karten")}
      </h3>
      <ul className="list">
        {[...jobs].reverse().map((j) => {
          const here = intentOf(j.target) === "map" || intentOf(j.target) === "extend";
          // What the student asked for; the map's own title when it says something else.
          const title = j.label || j.map?.title || "";
          const mapped = j.map && j.map.title !== title ? j.map.title : "";
          return (
            <li key={j.id} className="list-item job" aria-current={j.id === open ? "true" : undefined}>
              <span className="job-main">
                <span className="job-icon">{isActive(j) ? <span className="spinner" aria-hidden="true" /> : <Icon name={j.status === "ready" ? "compass" : "flag"} />}</span>
                <span className="list-main">
                  <span className="list-title">{title}</span>
                  {mapped ? <span className="meta">{t(`Mapped as “${mapped}”`, `Cartographié comme « ${mapped} »`, `Kartiert als „${mapped}“`)}</span> : null}
                  <span className={j.status === "error" ? "error-text" : "meta"} role={isActive(j) ? "status" : undefined}>
                    {jobStatus(j, now, t)}
                  </span>
                </span>
              </span>
              <span className="row">
                {j.status === "ready" ? (
                  here ? (
                    <button type="button" className="secondary small" disabled={j.id === open} onClick={() => onShow(j.id)}>
                      {j.id === open ? t("Shown above", "Affichée", "Oben") : t(`Open “${title}”`, `Ouvrir « ${title} »`, `„${title}“ öffnen`)}
                    </button>
                  ) : (
                    <a className="button secondary small" href={href.discover(j.target)}>
                      {t(`Open “${title}”`, `Ouvrir « ${title} »`, `„${title}“ öffnen`)}
                    </a>
                  )
                ) : null}
                {j.status === "error" || j.status === "interrupted" ? (
                  <button type="button" className="secondary small" onClick={() => retryJob(j.id)}>
                    <Icon name="refresh" size={16} /> {t("Run again", "Relancer", "Erneut starten")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={isActive(j) ? t(`Stop “${title}”`, `Arrêter « ${title} »`, `„${title}“ stoppen`) : t(`Set “${title}” aside`, `Écarter « ${title} »`, `„${title}“ beiseitelegen`)}
                  onClick={() => removeJob(j.id)}
                >
                  <Icon name={isActive(j) ? "stop" : "x"} size={16} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function kindLabel(kind: SuggestionKind, t: T): string {
  switch (kind) {
    case "further":
      return t("Go further", "Aller plus loin", "Weiter gehen");
    case "prerequisite":
      return t("Needed first", "Prérequis", "Vorher nötig");
    case "related":
      return t("Next to it", "À côté", "Daneben");
  }
}

/** Topics suggested from the courses: made only when asked, kept on this device until the courses change. */
function Suggestions({ onShow }: { onShow: (id: string) => void }) {
  const { t, lang } = useLang();
  const jobs = useDiscoverJobs();
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const data = useLive(
    async () => {
      await loadLlm();
      return { ...(await loadSuggestions()), configured: Boolean(savedSettings()), to: recipient(), courses: await list("courses") };
    },
    ["courses", "concepts"],
    [n],
  );
  if (!data || !data.courses.length) return null;
  const titleOf = (id?: string) => data.courses.find((c) => c.id === id)?.title;
  // A suggestion becomes a map of its own (into its course when it is something the course lacks), running beside the others.
  const pick = (s: Suggestion) => {
    const from = data.courses.find((c) => c.id === s.courseId);
    const goal = !from ? "" : s.kind === "prerequisite" ? t(`What “${from.title}” needs first`, `Ce dont « ${from.title} » a besoin d'abord`, `Was „${from.title}“ zuerst braucht`) : t(`Go further after “${from.title}”`, `Aller plus loin après « ${from.title} »`, `Weiter nach „${from.title}“`);
    startJob({ kind: "topic", topic: s.title, level: s.level, goal, language: from?.language ?? lang }, s.kind === "prerequisite" && from ? { courseId: from.id } : {});
  };
  const jobOf = (s: Suggestion) => jobs.findLast((j) => j.input.topic === s.title);
  const ask = async () => {
    setBusy(true);
    setError("");
    try {
      await suggestTopics(lang);
      setN((x) => x + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const askButton = (label: string) => (
    <button type="button" className={data.items.length ? "link" : "secondary"} disabled={!data.configured || busy} onClick={() => void ask()}>
      <Icon name="sparkle" size={16} /> {busy ? t("Thinking of topics…", "Recherche de sujets…", "Themen werden gesucht…") : label}
    </button>
  );
  return (
    <div className="suggestions" aria-labelledby="suggestions-title">
      <h3 className="section-title" id="suggestions-title">
        {t("Suggested from your courses", "Suggéré d'après vos cours", "Vorschläge aus Ihren Kursen")}
      </h3>
      {data.items.length ? (
        <ul className="suggestion-list">
          {data.items.map((s) => {
            const from = titleOf(s.courseId);
            return (
              <li key={s.title} className="suggestion">
                <div className="suggestion-main">
                  <span className="meta suggestion-kind">
                    {kindLabel(s.kind, t)}
                    {from ? ` · ${from}` : ""}
                  </span>
                  <span className="list-title">{s.title}</span>
                  {s.why ? <span className="meta">{s.why}</span> : null}
                </div>
                <span className="row">
                  {(() => {
                    const job = jobOf(s);
                    if (job && isActive(job))
                      return (
                        <span className="meta" role="status">
                          <span className="spinner" aria-hidden="true" /> {t("Mapping…", "Carte en cours…", "Wird kartiert…")}
                        </span>
                      );
                    if (job?.status === "ready")
                      return (
                        <button type="button" className="secondary small" onClick={() => onShow(job.id)} aria-label={t(`See the map of “${s.title}”`, `Voir la carte de « ${s.title} »`, `Karte von „${s.title}“ ansehen`)}>
                          <Icon name="compass" size={16} /> {t("See the map", "Voir la carte", "Karte ansehen")}
                        </button>
                      );
                    return (
                      <button type="button" className="secondary small" disabled={!data.configured} onClick={() => pick(s)} aria-label={t(`Map “${s.title}”`, `Cartographier « ${s.title} »`, `„${s.title}“ kartieren`)}>
                        <Icon name="compass" size={16} /> {t("Map it", "Cartographier", "Kartieren")}
                      </button>
                    );
                  })()}
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t(`Set “${s.title}” aside`, `Écarter « ${s.title} »`, `„${s.title}“ beiseitelegen`)}
                    onClick={() => void dismissSuggestion(s.title).then(() => setN((x) => x + 1))}
                  >
                    <Icon name="x" size={16} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {data.stale ? <p className="meta">{t("Your courses changed since these were suggested.", "Vos cours ont changé depuis ces suggestions.", "Ihre Kurse haben sich seit diesen Vorschlägen geändert.")}</p> : null}
      <div className="row">
        {askButton(data.items.length ? t("Suggest others", "En suggérer d'autres", "Andere vorschlagen") : t("Suggest topics from my courses", "Suggérer des sujets d'après mes cours", "Themen aus meinen Kursen vorschlagen"))}
      </div>
      {data.configured ? (
        <p className="meta">
          {t(
            `Your course and topic titles, their concepts' names and how well you know them are sent to ${data.to}. Nothing is searched until you map one.`,
            `Les titres de vos cours et sujets, les noms de leurs notions et votre maîtrise sont envoyés à ${data.to}. Rien n'est cherché tant que vous n'en cartographiez pas un.`,
            `Die Titel Ihrer Kurse und Themen, die Namen ihrer Begriffe und wie gut Sie sie kennen, werden an ${data.to} gesendet. Gesucht wird erst, wenn Sie eines kartieren.`,
          )}
        </p>
      ) : null}
      {error ? <Notice kind="error">{error}</Notice> : null}
    </div>
  );
}

function DiscoverFlow({ target, ctx, compact, open, onOpen }: { target: DiscoverTarget; ctx?: DiscoverContext; compact?: boolean; open?: string; onOpen: (id: string | undefined) => void }) {
  const { t, lang } = useLang();
  const fixed = intentOf(target);
  const [draft] = useState(() => loadDraft(target));
  const [mountedAt] = useState(Date.now);
  const course = ctx?.course;
  const blank: DiscoverInput = { kind: "topic", topic: "", level: (course?.level as Level | undefined) ?? "beginner", goal: course?.goal ?? "", language: course?.language ?? lang };
  const [input, setInput] = useState<DiscoverInput>(draft?.input ?? blank);
  // Where a new map goes, when the screen was not opened from a course: "" for a new topic.
  const [into, setInto] = useState(draft?.into ?? "");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const jobs = useDiscoverJobs();
  const job = jobs.find((j) => j.id === open);
  const now = useElapsed(Boolean(job && isActive(job)));
  useEffect(() => {
    if (!creating) saveDraft({ input, into: into || undefined, open }, target);
  }, [input, into, open, creating]);
  const ai = useLive(
    async () => {
      await loadLlm();
      const configured = Boolean(savedSettings());
      return { configured, web: configured && canSearch(), to: recipient() };
    },
    [],
    [],
  );
  const courses = useLive(async () => (await list("courses")).sort((a, b) => b.updatedAt - a.updatedAt), ["courses"], []);
  if (!ai || !courses) return <div aria-busy="true" />;

  const effective: DiscoverTarget = fixed === "map" && into ? { courseId: into } : target;
  const intent = intentOf(effective);
  const destination: Course | undefined = course ?? courses.find((c) => c.id === into);
  const seed = seedText(input.kind, t);
  const needsText = intent === "map" || intent === "extend";
  const blocked = !ai.configured || (needsText && !input.topic.trim()) || (intent === "refresh" && !ai.web) || creating;
  // The map shown is the job's, with the place it was made for.
  const shownIntent = job ? intentOf(job.target) : intent;
  const shownInto = job?.target.courseId ? (course?.id === job.target.courseId ? course : courses.find((c) => c.id === job.target.courseId)) : undefined;

  const run = () => {
    setError("");
    const label = intent === "dig" ? (ctx?.concept?.title ?? "") : intent === "refresh" ? (destination?.title ?? "") : input.topic.trim();
    onOpen(startJob(input, effective, label));
  };

  const create = async () => {
    if (!job?.map) return;
    setCreating(true);
    try {
      const made = await applyDiscovery(job.input, job.target, job.map, { proposals: job.chosen ?? [], concepts: job.concepts ?? [] });
      removeJob(job.id);
      clearDraft(target);
      go(shownIntent === "map" ? href.course(made.id) : href.course(made.id, shownIntent === "dig" ? "progress" : "sources"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  };

  const set = <K extends keyof DiscoverInput>(k: K, v: DiscoverInput[K]) => setInput((x) => ({ ...x, [k]: v }));

  // A fresh form; the map shown stays among Your maps.
  const restart = () => {
    setInput(blank);
    setInto("");
    setError("");
    onOpen(undefined);
  };

  const sentence = (() => {
    const name = destination?.title ?? "";
    switch (intent) {
      case "dig":
        return t(
          `The concept “${ctx?.concept?.title ?? ""}”, its summary, the title of “${name}” and its concepts' names, your level and goal are sent to ${ai.to}`,
          `La notion « ${ctx?.concept?.title ?? ""} », son résumé, le titre de « ${name} » et les noms de ses notions, votre niveau et objectif sont envoyés à ${ai.to}`,
          `Der Begriff „${ctx?.concept?.title ?? ""}“, seine Zusammenfassung, der Titel von „${name}“ und die Namen seiner Begriffe, Ihr Niveau und Ziel werden an ${ai.to} gesendet`,
        );
      case "refresh":
        return t(
          `The title of “${name}”, its concepts' names, the links of its sources, your level and goal are sent to ${ai.to}`,
          `Le titre de « ${name} », les noms de ses notions, les liens de ses sources, votre niveau et objectif sont envoyés à ${ai.to}`,
          `Der Titel von „${name}“, die Namen seiner Begriffe, die Links seiner Quellen, Ihr Niveau und Ziel werden an ${ai.to} gesendet`,
        );
      case "extend":
        return t(`${seed.what}, level and goal, with the title of “${name}” and its concepts' names, are sent to ${ai.to}`, `${seed.what}, niveau et objectif, avec le titre de « ${name} » et les noms de ses notions, sont envoyés à ${ai.to}`, `${seed.what}, Niveau und Ziel, mit dem Titel von „${name}“ und den Namen seiner Begriffe, werden an ${ai.to} gesendet`);
      default:
        return t(`${seed.what}, level and goal are sent to ${ai.to}`, `${seed.what}, niveau et objectif sont envoyés à ${ai.to}`, `${seed.what}, Niveau und Ziel werden an ${ai.to} gesendet`);
    }
  })();

  const action = { map: t("Map the topic", "Cartographier le sujet", "Thema kartieren"), extend: t("Find what to add", "Trouver quoi ajouter", "Finden, was dazukommt"), dig: t("Dig deeper", "Creuser", "Vertiefen"), refresh: t("Find new sources", "Trouver de nouvelles sources", "Neue Quellen finden") }[intent];

  const options = (
    <div className="grid discover-options">
      <Field label={t("Your level", "Votre niveau", "Ihr Niveau")}>
        <select value={input.level} onChange={(e) => set("level", e.currentTarget.value as Level)}>
          <option value="beginner">{t("Beginner", "Débutant", "Anfänger")}</option>
          <option value="intermediate">{t("Intermediate", "Intermédiaire", "Fortgeschritten")}</option>
          <option value="advanced">{t("Advanced", "Avancé", "Experte")}</option>
        </select>
      </Field>
      <Field label={t("Your goal", "Votre objectif", "Ihr Ziel")}>
        <input value={input.goal} list="discover-goals" maxLength={300} onChange={(e) => set("goal", e.currentTarget.value)} placeholder={t("e.g. pass the June exam", "ex. réussir l'examen de juin", "z. B. die Prüfung im Juni bestehen")} />
        <datalist id="discover-goals">
          <option value={t("Pass an exam", "Réussir un examen", "Eine Prüfung bestehen")} />
          <option value={t("General knowledge", "Culture générale", "Allgemeinwissen")} />
          <option value={t("A project", "Un projet", "Ein Projekt")} />
        </datalist>
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
      {fixed === "map" && courses.length ? (
        <Field label={t("Where it goes", "Où le mettre", "Wohin damit")}>
          <select
            value={into}
            onChange={(e) => setInto(e.currentTarget.value)}
          >
            <option value="">{t("A new topic", "Un nouveau sujet", "Ein neues Thema")}</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {t(`Into “${c.title}”`, `Dans « ${c.title} »`, `In „${c.title}“`)}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
    </div>
  );

  return (
    <>
      <div className={compact ? "discover-flow" : "paper"}>
        {!ai.configured ? (
          <Notice>
            {t("Discover uses your own AI provider.", "Découvrir utilise votre propre fournisseur d'IA.", "Entdecken nutzt Ihren eigenen KI-Anbieter.")} <a href={href.settings("ai")}>{t("Set one up", "En configurer un", "Einen einrichten")}</a>
          </Notice>
        ) : null}
        {job?.status === "interrupted" ? (
          <Notice>
            {t("The page was reloaded while the map was being made, so it was lost. Your topic is still here: map it again.", "La page a été rechargée pendant la carte du sujet, qui a été perdue. Votre sujet est conservé : relancez la carte.", "Die Seite wurde während der Kartierung neu geladen, die Karte ging verloren. Ihr Thema ist noch da: Kartieren Sie es erneut.")}{" "}
            <button type="button" className="link" onClick={() => retryJob(job.id)}>
              {t("Run again", "Relancer", "Erneut starten")}
            </button>
          </Notice>
        ) : job?.status === "ready" && (job.finishedAt ?? 0) < mountedAt ? (
          <Notice>{t("Picked up where you left off: this map is not a topic yet.", "Repris là où vous en étiez : cette carte n'est pas encore un sujet.", "Dort fortgesetzt, wo Sie aufgehört haben: Diese Karte ist noch kein Thema.")}</Notice>
        ) : null}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          {needsText ? (
            <>
              <div className="discover-seed">
                <Segmented options={SEED_KINDS.map((k) => ({ id: k, label: seedText(k, t).tab }))} value={input.kind} onChange={(k) => set("kind", k)} label={t("What you bring", "Ce que vous apportez", "Was Sie mitbringen")} />
              </div>
              <Field label={seed.label}>
                <input value={input.topic} required maxLength={500} onChange={(e) => set("topic", e.currentTarget.value)} placeholder={seed.placeholder} />
              </Field>
            </>
          ) : null}
          {compact ? (
            <details className="disclosure">
              <summary>{t("Options: level, goal, language, where it goes", "Options : niveau, objectif, langue, où le mettre", "Optionen: Niveau, Ziel, Sprache, wohin")}</summary>
              {options}
            </details>
          ) : (
            options
          )}
          {ai.configured ? (
            <Notice>
              {sentence}
              {ai.web
                ? t(", which searches the web with its own search tool.", ", qui cherche sur le web avec son propre outil de recherche.", ", das mit seinem eigenen Suchwerkzeug im Web sucht.")
                : intent === "refresh"
                  ? t(". This model cannot search the web, and new sources need a web search: choose a model with web search (Claude, GPT, Gemini) in Settings.", ". Ce modèle ne peut pas chercher sur le web, et de nouvelles sources demandent une recherche web : choisissez un modèle avec recherche web (Claude, GPT, Gemini) dans les Réglages.", ". Dieses Modell kann nicht im Web suchen, und neue Quellen brauchen eine Websuche: Wählen Sie in den Einstellungen ein Modell mit Websuche (Claude, GPT, Gemini).")
                  : t(
                      ". This model cannot search the web: the plan comes from its own knowledge, and its reading suggestions are unsourced, to verify. A model with web search (Claude, GPT, Gemini) finds real sources.",
                      ". Ce modèle ne peut pas chercher sur le web : le plan vient de ses propres connaissances, et ses suggestions de lecture sont non sourcées, à vérifier. Un modèle avec recherche web (Claude, GPT, Gemini) trouve de vraies sources.",
                      ". Dieses Modell kann nicht im Web suchen: Der Plan stammt aus seinem eigenen Wissen, seine Lesevorschläge sind ohne Quelle und zu prüfen. Ein Modell mit Websuche (Claude, GPT, Gemini) findet echte Quellen.",
                    )}
            </Notice>
          ) : null}
          <div className="row">
            <button type="submit" className="primary" disabled={blocked}>
              <Icon name="compass" size={18} /> {action}
            </button>
            {input.topic || (needsText && input.goal) || job ? (
              <button type="button" className="link" disabled={creating} onClick={restart}>
                {t("Start over", "Recommencer", "Neu beginnen")}
              </button>
            ) : null}
          </div>
          {job && isActive(job) ? (
            <div className="row discover-progress">
              <span className="spinner" aria-hidden="true" />
              <span className="meta" role="status">
                {job.label || job.map?.title} · {jobStatus(job, now, t)}
              </span>
              <button
                type="button"
                className="secondary small"
                onClick={() => {
                  removeJob(job.id);
                  onOpen(undefined);
                }}
              >
                <Icon name="stop" size={16} /> {t("Stop", "Arrêter", "Stopp")}
              </button>
            </div>
          ) : null}
          {compact && job && isActive(job) ? <p className="meta">{t("You can map something else meanwhile, or leave this page: it keeps going.", "Vous pouvez en cartographier un autre en attendant, ou quitter la page : la carte continue.", "Sie können inzwischen etwas anderes kartieren oder die Seite verlassen: Es läuft weiter.")}</p> : null}
        </form>
      </div>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {job?.status === "error" ? (
        <Notice kind="error">
          {job.error}{" "}
          <button type="button" className="link" onClick={() => retryJob(job.id)}>
            {t("Run again", "Relancer", "Erneut starten")}
          </button>
        </Notice>
      ) : null}
      {job?.status === "ready" && job.map ? (
        <Result
          map={job.map}
          intent={shownIntent}
          into={shownInto}
          chosen={new Set(job.chosen)}
          setChosen={(c) => chooseInJob(job.id, { chosen: [...c] })}
          concepts={new Set(job.concepts)}
          setConcepts={(c) => chooseInJob(job.id, { concepts: [...c] })}
          creating={creating}
          onCreate={() => void create()}
          compact={compact}
        />
      ) : null}
    </>
  );
}

const toggle = (set: Set<number>, i: number, on: boolean) => {
  const next = new Set(set);
  if (on) next.add(i);
  else next.delete(i);
  return next;
};

function Result({
  map,
  intent,
  into,
  chosen,
  setChosen,
  concepts,
  setConcepts,
  creating,
  onCreate,
  compact,
}: {
  map: TopicMap;
  intent: Intent;
  into?: Course;
  chosen: Set<number>;
  setChosen: (s: Set<number>) => void;
  concepts: Set<number>;
  setConcepts: (s: Set<number>) => void;
  creating: boolean;
  onCreate: () => void;
  compact?: boolean;
}) {
  const { t } = useLang();
  const H = compact ? "h3" : "h2";
  const Sub = compact ? "h4" : "h3";
  const titleOf = new Map(map.concepts.map((c) => [c.title.toLowerCase(), c.title]));
  const name = into?.title ?? "";
  const notes = count(chosen.size + (map.explanation ? 1 : 0), ["note", "notes"], ["note", "notes"], ["Notiz", "Notizen"]);
  const after = (c: TopicMap["concepts"][number]) =>
    c.prerequisites?.length ? (
      <span className="meta">
        {" "}
        · {t("after", "après", "nach")} {c.prerequisites.map((p) => titleOf.get(p.toLowerCase()) ?? p).join(", ")}
      </span>
    ) : null;
  return (
    <section className="paper discover-result" aria-labelledby="discover-map">
      <H id="discover-map">{map.title}</H>
      {map.overview ? <p className="lead">{map.overview}</p> : null}
      {map.explanation ? (
        <div className="discover-explanation">
          <Markdown text={map.explanation} />
        </div>
      ) : null}
      {intent === "map" ? (
        <>
          <Sub className="section-title">{t("Concepts, in the order to learn them", "Notions, dans l'ordre où les apprendre", "Begriffe in der Lernreihenfolge")}</Sub>
          <ol className="discover-concepts">
            {map.concepts.map((c) => (
              <li key={c.title}>
                <strong>{c.title}</strong>
                {after(c)}
                {c.summary ? <p className="meta">{c.summary}</p> : null}
              </li>
            ))}
          </ol>
        </>
      ) : map.concepts.length ? (
        <fieldset className="proposals">
          <legend>{intent === "dig" ? t("Sub-concepts", "Sous-notions", "Unterbegriffe") : t("Concepts to add", "Notions à ajouter", "Hinzuzufügende Begriffe")}</legend>
          <ul className="proposal-list">
            {map.concepts.map((c, i) => (
              <li key={c.title} className="proposal">
                <label className="check">
                  <input type="checkbox" checked={concepts.has(i)} onChange={(e) => setConcepts(toggle(concepts, i, e.currentTarget.checked))} />
                  <span className="list-title">{c.title}</span>
                  {after(c)}
                </label>
                <div className="proposal-body">
                  {c.match ? <p className="hint">{t("Already in the course", "Déjà dans le cours", "Schon im Kurs")}</p> : null}
                  {c.summary ? <p className="meta">{c.summary}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
      <fieldset className="proposals">
        <legend>{map.web ? t("Sources found on the web", "Sources trouvées sur le web", "Im Web gefundene Quellen") : t("Reading suggestions (unsourced, to verify)", "Suggestions de lecture (non sourcées, à vérifier)", "Lesevorschläge (ohne Quelle, zu prüfen)")}</legend>
        {map.web ? (
          <p className="meta">
            {t(
              "Ticked ones become notes, with their link and what the search said about them. amphi does not open these pages itself (a web page cannot read other sites): open them, then paste what matters or drop the PDF in.",
              "Celles cochées deviennent des notes, avec leur lien et ce que la recherche en a dit. amphi n'ouvre pas ces pages lui-même (une page web ne peut pas lire d'autres sites) : ouvrez-les, puis collez ce qui compte ou déposez le PDF.",
              "Angehakte werden zu Notizen, mit ihrem Link und dem, was die Suche über sie sagte. amphi öffnet diese Seiten nicht selbst (eine Webseite kann andere Websites nicht lesen): Öffnen Sie sie und fügen Sie das Wichtige ein oder legen Sie das PDF ab.",
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
        {map.skipped ? (
          <p className="meta">
            {t(
              `${count(map.skipped, ["page", "pages"], ["page", "pages"], ["Seite", "Seiten"])} already in the course left out.`,
              `${count(map.skipped, ["page", "pages"], ["page", "pages"], ["Seite", "Seiten"])} déjà dans le cours, écartée(s).`,
              `${count(map.skipped, ["page", "pages"], ["page", "pages"], ["Seite", "Seiten"])} schon im Kurs, weggelassen.`,
            )}
          </p>
        ) : null}
        {map.proposals.length ? (
          <ul className="proposal-list">
            {map.proposals.map((p, i) => (
              <ProposalItem key={`${p.url ?? ""}${p.title}`} p={p} checked={chosen.has(i)} onChange={(on) => setChosen(toggle(chosen, i, on))} />
            ))}
          </ul>
        ) : (
          <p className="meta">{t("No source was proposed.", "Aucune source proposée.", "Keine Quelle vorgeschlagen.")}</p>
        )}
      </fieldset>
      <p className="meta">
        {intent === "map"
          ? t(
              `Creates the topic with ${count(map.concepts.length, ["concept", "concepts"], ["notion", "notions"], ["Begriff", "Begriffen"])}, ${notes} and a mind map. Nothing more is sent.`,
              `Crée le sujet avec ${count(map.concepts.length, ["concept", "concepts"], ["notion", "notions"], ["Begriff", "Begriffen"])}, ${notes} et une carte mentale. Rien d'autre n'est envoyé.`,
              `Erstellt das Thema mit ${count(map.concepts.length, ["concept", "concepts"], ["notion", "notions"], ["Begriff", "Begriffen"])}, ${notes} und einer Mindmap. Nichts weiter wird gesendet.`,
            )
          : t(
              `Adds ${notes} and ${count(concepts.size, ["concept", "concepts"], ["notion", "notions"], ["Begriff", "Begriffe"])} to “${name}”. Nothing more is sent.`,
              `Ajoute ${notes} et ${count(concepts.size, ["concept", "concepts"], ["notion", "notions"], ["Begriff", "Begriffe"])} à « ${name} ». Rien d'autre n'est envoyé.`,
              `Fügt „${name}“ ${notes} und ${count(concepts.size, ["concept", "concepts"], ["notion", "notions"], ["Begriff", "Begriffe"])} hinzu. Nichts weiter wird gesendet.`,
            )}
      </p>
      <div className="row">
        <button type="button" className="primary" disabled={creating || (intent !== "map" && !chosen.size && !concepts.size && !map.explanation)} onClick={onCreate}>
          <Icon name="plus" size={18} /> {intent === "map" ? t("Create the topic", "Créer le sujet", "Thema erstellen") : t(`Add to “${name}”`, `Ajouter à « ${name} »`, `Zu „${name}“ hinzufügen`)}
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
        {p.status === "given" ? <p className="hint">{t("The link you gave", "Le lien que vous avez donné", "Der Link, den Sie angegeben haben")}</p> : null}
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
