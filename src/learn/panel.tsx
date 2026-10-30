// Progress of a course or a topic: its concepts in learning order with how
// well each is known (src/learn/progress.ts), self-assessment, a Socratic
// tutor per concept, the quizzes taken, what was made, and the exam
// countdown.

import { useEffect, useRef, useState } from "react";
import { loadLlm, recipient, savedSettings } from "../ai/llm.ts";
import { ChatPanel } from "../chat/panel.tsx";
import { fresh, get, list, put, remove, update } from "../data/db.ts";
import { useLive } from "../data/hooks.ts";
import type { Artifact, Concept, Course, Id, Source } from "../data/schema.ts";
import { colon, count, currentLang, dateOnly, relative, useLang } from "../i18n.ts";
import { href } from "../router.ts";
import { hasText } from "../studio/panel.tsx";
import type { QuizData } from "../studio/quiz-core.ts";
import { openCitation } from "../ui/cite.ts";
import { Icon } from "../ui/icons.tsx";
import { Empty, Notice } from "../ui/kit.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { generateConcepts } from "./concepts.ts";
import { daysUntil } from "./next.ts";
import { type Mastery, masteryByConcept } from "./progress.ts";
import { endTutorSession, hasStudentTurn, type SessionEnd, tutorChat, tutorSystem } from "./tutor.ts";

export function ProgressPanel({ courseId }: { courseId: Id }) {
  const { t } = useLang();
  const [tutor, setTutor] = useState<{ concept: Concept; chatId: Id } | null>(null);
  const [error, setError] = useState("");
  const data = useLive(
    async () => {
      await loadLlm();
      const [course, concepts, events, artifacts, sources] = await Promise.all([get("courses", courseId), list("concepts", "courseId", courseId), list("events", "courseId", courseId), list("artifacts", "courseId", courseId), list("sources", "courseId", courseId)]);
      const sorted = concepts.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
      return {
        course,
        concepts: sorted,
        mastery: masteryByConcept(sorted, events),
        artifacts: artifacts.filter((a) => a.status === "ready").sort((a, b) => b.updatedAt - a.updatedAt),
        sources: sources.filter(hasText).sort((a, b) => a.createdAt - b.createdAt),
        configured: Boolean(savedSettings()),
      };
    },
    ["courses", "concepts", "events", "artifacts", "sources"],
    [courseId],
  );
  if (!data?.course) return <div aria-busy="true" />;
  const { course, concepts, mastery, artifacts, sources, configured } = data;
  const language = course.language || currentLang();

  if (tutor) return <TutorSession key={tutor.chatId} concept={tutor.concept} chatId={tutor.chatId} sources={sources} language={language} onClose={() => setTutor(null)} />;

  const openTutor = async (c: Concept) => {
    setError("");
    try {
      const chat = await tutorChat(c, language);
      setTutor({ concept: c, chatId: chat.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const quizzes = artifacts.filter((a) => a.type === "quiz") as Artifact<QuizData>[];
  const made = artifacts.filter((a) => a.type !== "quiz");

  return (
    <section className="stack progress-panel">
      <ExamCountdown course={course} />
      {!configured ? (
        <Notice>
          {t("Finding concepts and the tutor use your own AI provider.", "La recherche des notions et le tuteur utilisent votre propre fournisseur d'IA.", "Begriffssuche und Tutor nutzen Ihren eigenen KI-Anbieter.")} <a href={href.settings("ai")}>{t("Set one up", "En configurer un", "Einen einrichten")}</a>
        </Notice>
      ) : null}
      <h2 className="section-title">{t("Concepts", "Notions", "Begriffe")}</h2>
      {concepts.length ? (
        <>
          <p className="meta">
            {t(
              "Mastery from 0 to 4 comes from your quiz answers, flashcards, self-assessments and tutor sessions; recent ones count more.",
              "La maîtrise de 0 à 4 vient de vos réponses aux quiz, cartes, auto-évaluations et séances de tutorat ; les plus récentes comptent davantage.",
              "Die Beherrschung von 0 bis 4 ergibt sich aus Quizantworten, Lernkarten, Selbsteinschätzungen und Tutorsitzungen; neuere zählen mehr.",
            )}
          </p>
          <ol className="concepts">
            {concepts.map((c, i) => (
              <ConceptItem key={c.id} concept={c} index={i} concepts={concepts} mastery={mastery.get(c.id)!} sources={sources} configured={configured} onTutor={() => void openTutor(c)} />
            ))}
          </ol>
        </>
      ) : (
        <FindConcepts course={course} sources={sources} configured={configured} />
      )}
      {error ? <Notice kind="error">{error}</Notice> : null}
      <AddConcept courseId={courseId} next={(concepts.at(-1)?.order ?? 0) + 1} />
      <h2 className="section-title">{t("Quizzes", "Quiz", "Quizze")}</h2>
      {quizzes.length ? (
        <ul className="list">
          {quizzes.map((q) => {
            const results = q.data?.results ?? [];
            const last = results.at(-1);
            const best = results.reduce((b, r) => Math.max(b, r.total ? r.score / r.total : 0), 0);
            return (
              <li key={q.id} className="list-item">
                <a className="list-link" href={href.artifact(q.id)}>
                  <Icon name="quiz" />
                  <span className="list-main">
                    <span className="list-title">{q.title}</span>
                    <span className="meta">
                      {last
                        ? `${colon(t("Last score", "Dernier score", "Letztes Ergebnis"))} ${last.score} / ${last.total} · ${t("best", "meilleur", "bestes")} ${Math.round(best * 100)} % · ${count(results.length, ["attempt", "attempts"], ["essai", "essais"], ["Versuch", "Versuche"])} · ${relative(last.at)}`
                        : t("Not taken yet", "Pas encore passé", "Noch nicht gemacht")}
                    </span>
                  </span>
                  <Icon name="chevron-right" />
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="meta">{t("No quiz yet: make one in the Studio.", "Aucun quiz : créez-en un dans le Studio.", "Noch kein Quiz: Erstellen Sie eines im Studio.")}</p>
      )}
      <h2 className="section-title">{t("Also made for this course", "Aussi réalisé pour ce cours", "Außerdem für diesen Kurs erstellt")}</h2>
      {made.length ? (
        <ul className="list compact">
          {made.map((a) => (
            <li key={a.id} className="list-item">
              <a className="list-link" href={href.artifact(a.id)}>
                <span className="list-main">
                  <span className="list-title">{a.title}</span>
                  <span className="meta">{relative(a.updatedAt)}</span>
                </span>
                <Icon name="chevron-right" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta">{t("Nothing made yet.", "Rien de réalisé pour l'instant.", "Noch nichts erstellt.")}</p>
      )}
    </section>
  );
}

function ExamCountdown({ course }: { course: Course }) {
  const { t } = useLang();
  if (!course.examDate) return null;
  const days = daysUntil(course.examDate);
  const when = dateOnly(new Date(`${course.examDate}T00:00:00`).getTime());
  const text =
    days < 0
      ? t(`The exam was on ${when}.`, `L'examen a eu lieu le ${when}.`, `Die Prüfung war am ${when}.`)
      : days === 0
        ? t("The exam is today.", "L'examen est aujourd'hui.", "Die Prüfung ist heute.")
        : t(`Exam in ${count(days, ["day", "days"], ["jour", "jours"], ["Tag", "Tagen"])} (${when}).`, `Examen dans ${count(days, ["day", "days"], ["jour", "jours"], ["Tag", "Tagen"])} (${when}).`, `Prüfung in ${count(days, ["day", "days"], ["jour", "jours"], ["Tag", "Tagen"])} (${when}).`);
  return (
    <p className="exam-countdown">
      <Icon name="flag" size={18} /> {text}
    </p>
  );
}

function FindConcepts({ course, sources, configured }: { course: Course; sources: Source[]; configured: boolean }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  return (
    <Empty icon="target" title={t("No concept yet", "Aucune notion", "Noch keine Begriffe")}>
      <p>{t("The concepts to master are read from the sources, in the order to learn them; you can then edit them.", "Les notions à maîtriser sont lues dans les sources, dans l'ordre où les apprendre ; vous pourrez ensuite les modifier.", "Die zu beherrschenden Begriffe werden aus den Quellen gelesen, in der Lernreihenfolge; danach können Sie sie bearbeiten.")}</p>
      {sources.length ? (
        <p className="meta">{t(`The text of ${count(sources.length, ["source", "sources"], ["source", "sources"], ["Quelle", "Quellen"])} is sent to ${recipient()}.`, `Le texte de ${count(sources.length, ["source", "sources"], ["source", "sources"], ["Quelle", "Quellen"])} est envoyé à ${recipient()}.`, `Der Text von ${count(sources.length, ["source", "sources"], ["source", "sources"], ["Quelle", "Quellen"])} wird an ${recipient()} gesendet.`)}</p>
      ) : (
        <p className="meta">{t("Add sources first, or add the concepts yourself below.", "Ajoutez d'abord des sources, ou ajoutez les notions vous-même ci-dessous.", "Fügen Sie zuerst Quellen hinzu oder tragen Sie die Begriffe unten selbst ein.")}</p>
      )}
      <button
        type="button"
        className="primary"
        disabled={!configured || !sources.length || busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          abort.current = new AbortController();
          try {
            await generateConcepts(course, sources, abort.current.signal);
          } catch (e) {
            if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon name="sparkle" size={18} /> {busy ? t("Reading the sources…", "Lecture des sources…", "Quellen werden gelesen…") : t("Find the concepts in the sources", "Trouver les notions dans les sources", "Begriffe in den Quellen finden")}
      </button>
      {error ? <Notice kind="error">{error}</Notice> : null}
    </Empty>
  );
}

function MasteryMeter({ m }: { m: Mastery }) {
  const { t } = useLang();
  const label = m.events ? t(`Mastery ${m.level}/4`, `Maîtrise ${m.level}/4`, `Beherrschung ${m.level}/4`) : t("Not studied yet", "Pas encore étudié", "Noch nicht gelernt");
  return (
    <span className={`mastery level-${m.level}${m.events ? "" : " unseen"}`}>
      <span className="mastery-dots" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={n <= m.level ? "on" : undefined} />
        ))}
      </span>
      <span className="mastery-text">{label}</span>
      {m.events ? <span className="meta">· {count(m.events, ["sign", "signs"], ["indice", "indices"], ["Hinweis", "Hinweise"])}</span> : null}
    </span>
  );
}

const SELF: { score: number; label: (t: ReturnType<typeof useLang>["t"]) => string }[] = [
  { score: 1, label: (t) => t("Got it", "Acquis", "Sitzt") },
  { score: 0.5, label: (t) => t("Shaky", "Fragile", "Wackelig") },
  { score: 0, label: (t) => t("Not seen", "Pas vu", "Nicht gesehen") },
];

function ConceptItem({ concept: c, index, concepts, mastery, sources, configured, onTutor }: { concept: Concept; index: number; concepts: Concept[]; mastery: Mastery; sources: Source[]; configured: boolean; onTutor: () => void }) {
  const { t } = useLang();
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const after = c.prerequisites.map((id) => concepts.find((x) => x.id === id)?.title).filter((x) => x !== undefined);
  const sourceIds = sources.map((s) => s.id);
  const move = async (delta: -1 | 1) => {
    const j = index + delta;
    if (j < 0 || j >= concepts.length) return;
    const next = [...concepts];
    [next[index], next[j]] = [next[j]!, next[index]!];
    // Renumbered from 1, so equal orders (concepts added by hand) cannot keep two in place.
    for (const [i, x] of next.entries()) if (x.order !== i + 1) await update("concepts", x.id, { order: i + 1 });
  };
  const assess = (score: number) => void put("events", { ...fresh(), courseId: c.courseId, conceptId: c.id, kind: "self", score, at: Date.now() });
  return (
    <li className="concept">
      <div className="concept-head">
        <span className="concept-n" aria-hidden="true">
          {index + 1}
        </span>
        {renaming ? (
          <form
            className="row concept-rename"
            onSubmit={(e) => {
              e.preventDefault();
              const v = String(new FormData(e.currentTarget).get("title") ?? "").trim();
              if (v && v !== c.title) void update("concepts", c.id, { title: v });
              setRenaming(false);
            }}
          >
            <input name="title" defaultValue={c.title} autoFocus aria-label={t("Name of the concept", "Nom de la notion", "Name des Begriffs")} onKeyDown={(e) => e.key === "Escape" && setRenaming(false)} />
            <button type="submit" className="secondary small">
              {t("Save", "Enregistrer", "Speichern")}
            </button>
          </form>
        ) : (
          <h3 className="concept-title">
            {c.title}
          </h3>
        )}
        <MasteryMeter m={mastery} />
      </div>
      {c.summary ? <Markdown className="concept-summary" text={c.summary} onCite={(l) => openCitation(l, sourceIds)} /> : null}
      {after.length || c.refs.length ? (
        <p className="meta">
          {after.length ? `${colon(t("Builds on", "S'appuie sur", "Baut auf"))} ${after.join(", ")}` : ""}
          {c.refs.map((r) => (
            <span key={r}>
              {" "}
              <button type="button" className="cite" onClick={() => openCitation(r, sourceIds)}>
                {r}
              </button>
            </span>
          ))}
        </p>
      ) : null}
      <div className="row concept-actions">
        <div className="segmented" role="group" aria-label={t(`How well do you know “${c.title}”?`, `Connaissez-vous bien « ${c.title} » ?`, `Wie gut kennen Sie „${c.title}“?`)}>
          {SELF.map((s) => (
            <button key={s.score} type="button" onClick={() => assess(s.score)}>
              {s.label(t)}
            </button>
          ))}
        </div>
        <button type="button" className="secondary small" disabled={!configured} onClick={onTutor}>
          <Icon name="chat" size={16} /> {t("Work on it with the tutor", "Travailler avec le tuteur", "Mit dem Tutor üben")}
        </button>
        <span className="concept-edit">
          <button type="button" className="icon-button" aria-label={t(`Rename “${c.title}”`, `Renommer « ${c.title} »`, `„${c.title}“ umbenennen`)} onClick={() => setRenaming(true)}>
            <Icon name="edit" size={16} />
          </button>
          <button type="button" className="icon-button move-up" disabled={index === 0} aria-label={t(`Move “${c.title}” up`, `Monter « ${c.title} »`, `„${c.title}“ nach oben`)} onClick={() => void move(-1)}>
            <Icon name="chevron-left" size={16} />
          </button>
          <button type="button" className="icon-button move-down" disabled={index === concepts.length - 1} aria-label={t(`Move “${c.title}” down`, `Descendre « ${c.title} »`, `„${c.title}“ nach unten`)} onClick={() => void move(1)}>
            <Icon name="chevron-right" size={16} />
          </button>
          {confirmDelete ? (
            <button type="button" className="danger small" onClick={() => void remove("concepts", c.id)}>
              {t("Delete", "Supprimer", "Löschen")}
            </button>
          ) : (
            <button type="button" className="icon-button" aria-label={t(`Delete “${c.title}”`, `Supprimer « ${c.title} »`, `„${c.title}“ löschen`)} onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={16} />
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

function AddConcept({ courseId, next }: { courseId: Id; next: number }) {
  const { t } = useLang();
  const [title, setTitle] = useState("");
  return (
    <form
      className="row add-concept"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        void put("concepts", { ...fresh(), courseId, title: title.trim(), summary: "", order: next, prerequisites: [], refs: [] });
        setTitle("");
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.currentTarget.value)} aria-label={t("New concept", "Nouvelle notion", "Neuer Begriff")} placeholder={t("Add a concept…", "Ajouter une notion…", "Begriff hinzufügen…")} />
      <button type="submit" className="secondary" disabled={!title.trim()}>
        <Icon name="plus" size={18} /> {t("Add", "Ajouter", "Hinzufügen")}
      </button>
    </form>
  );
}

function TutorSession({ concept, chatId, sources, language, onClose }: { concept: Concept; chatId: Id; sources: Source[]; language: string; onClose: () => void }) {
  const { t } = useLang();
  const chat = useLive(() => get("chats", chatId), ["chats"], [chatId]);
  const [ending, setEnding] = useState(false);
  const [ended, setEnded] = useState<SessionEnd | null>(null);
  const [error, setError] = useState("");
  const end = async () => {
    setEnding(true);
    setError("");
    try {
      const cur = await get("chats", chatId);
      if (cur) setEnded(await endTutorSession(cur, concept, sources, language));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnding(false);
    }
  };
  return (
    <section className="stack tutor" aria-labelledby="tutor-title">
      <div className="row between">
        <button type="button" className="link" onClick={onClose}>
          <Icon name="chevron-left" size={18} /> {t("All concepts", "Toutes les notions", "Alle Begriffe")}
        </button>
        {!ended ? (
          <button type="button" className="primary" disabled={ending || !chat || !hasStudentTurn(chat)} onClick={() => void end()}>
            <Icon name="check" size={18} /> {ending ? t("Ending the session…", "Fin de la séance…", "Sitzung wird beendet…") : t("End the session", "Terminer la séance", "Sitzung beenden")}
          </button>
        ) : null}
      </div>
      <h2 id="tutor-title">
        {colon(t("Tutor", "Tuteur", "Tutor"))} {concept.title}
      </h2>
      {ended ? (
        <Notice kind="ok">
          <span role="status">
            {t(`Session ended. Understanding: ${Math.round(ended.score * 100)} %.`, `Séance terminée. Compréhension : ${Math.round(ended.score * 100)} %.`, `Sitzung beendet. Verständnis: ${Math.round(ended.score * 100)} %.`)}
          </span>
          {ended.reason ? ` ${ended.reason}` : ""}{" "}
          {t("The summary is saved as a note.", "Le résumé est enregistré comme note.", "Die Zusammenfassung ist als Notiz gespeichert.")}
        </Notice>
      ) : (
        <p className="meta">
          {t(
            "The tutor asks questions rather than giving answers. End the session when you are done: it is summarised, and how well you understood counts towards the concept's mastery.",
            "Le tuteur pose des questions plutôt que de donner les réponses. Terminez la séance quand vous avez fini : elle est résumée, et votre compréhension compte pour la maîtrise de la notion.",
            "Der Tutor stellt Fragen, statt Antworten zu geben. Beenden Sie die Sitzung, wenn Sie fertig sind: Sie wird zusammengefasst, und Ihr Verständnis zählt für die Beherrschung des Begriffs.",
          )}
        </p>
      )}
      {error ? <Notice kind="error">{error}</Notice> : null}
      <ChatPanel key={chatId} courseId={concept.courseId} chatId={chatId} extraSystem={tutorSystem(concept)} />
    </section>
  );
}
