// Quizzes: multiple choice, true/false and short answers (graded by the
// model against the expected answer), taken one question at a time or all at
// once, timed or free. Every answer is a study event for Progress; the score
// comes at the end, with the explanations and their sources, and the missed
// questions can be tried again.

import { type FormEvent, useEffect, useRef, useState } from "react";
import { budgetFor, buildContext } from "../ai/context.ts";
import { capabilities, writeIn } from "../ai/llm.ts";
import { askJson } from "../ai/structured.ts";
import { fresh, list, put } from "../data/db.ts";
import { conceptRule } from "../learn/concepts.ts";
import type { Artifact } from "../data/schema.ts";
import { clock, colon, trIn, useLang } from "../i18n.ts";
import { openCitation } from "../ui/cite.ts";
import { Icon } from "../ui/icons.tsx";
import { Field, Notice, Segmented, slug } from "../ui/kit.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { answerText, Grade, missed, type Question, QuizAnswer, type QuizData, quizMarkdown, type Response, SHAPE, scoreChoice, tally, timeFor, type Verdict, verdictOf, verdictScore } from "./quiz-core.ts";
import { kind, type OptionsProps, type ViewProps } from "./types.ts";

export type QuizKinds = "mixed" | "mcq" | "truefalse" | "short";
export type Difficulty = "easy" | "medium" | "hard";

export interface QuizOptions extends Record<string, unknown> {
  count: 5 | 10 | 20;
  kinds: QuizKinds;
  difficulty: Difficulty;
  focus: string;
}

function Options({ value, onChange }: OptionsProps<QuizOptions>) {
  const { t } = useLang();
  return (
    <div className="stack">
      <Field label={t("Questions", "Questions", "Fragen")}>
        <select value={value.count} onChange={(e) => onChange({ ...value, count: Number(e.currentTarget.value) as QuizOptions["count"] })}>
          {[5, 10, 20].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("Kind of questions", "Type de questions", "Art der Fragen")}>
        <select value={value.kinds} onChange={(e) => onChange({ ...value, kinds: e.currentTarget.value as QuizKinds })}>
          <option value="mixed">{t("Mixed", "Mélangées", "Gemischt")}</option>
          <option value="mcq">{t("Multiple choice", "QCM", "Multiple Choice")}</option>
          <option value="truefalse">{t("True or false", "Vrai ou faux", "Richtig oder falsch")}</option>
          <option value="short">{t("Short answer", "Réponse courte", "Kurze Antwort")}</option>
        </select>
      </Field>
      <Field label={t("Difficulty", "Difficulté", "Schwierigkeit")}>
        <select value={value.difficulty} onChange={(e) => onChange({ ...value, difficulty: e.currentTarget.value as Difficulty })}>
          <option value="easy">{t("Easy", "Facile", "Leicht")}</option>
          <option value="medium">{t("Medium", "Moyenne", "Mittel")}</option>
          <option value="hard">{t("Hard", "Difficile", "Schwer")}</option>
        </select>
      </Field>
      <Field label={t("Focus (optional)", "Angle (facultatif)", "Schwerpunkt (optional)")}>
        <input value={value.focus} onChange={(e) => onChange({ ...value, focus: e.currentTarget.value })} placeholder={t("e.g. the definitions, chapter 3", "ex. les définitions, le chapitre 3", "z. B. die Definitionen, Kapitel 3")} />
      </Field>
    </div>
  );
}

const KIND_RULE: Record<QuizKinds, string> = {
  mixed: "mix the kinds: about half multiple choice, a quarter true/false and a quarter short answer",
  mcq: 'all multiple choice ("mcq")',
  truefalse: 'all true/false ("truefalse")',
  short: 'all short answer ("short")',
};

const DIFFICULTY_RULE: Record<Difficulty, string> = {
  easy: "easy: recall of the key facts and definitions",
  medium: "medium: understanding, linking two ideas, applying a definition",
  hard: "hard: application to a new case, subtle distinctions, multi-step reasoning",
};

async function gradeShort(q: Question & { kind: "short" }, response: string, language: string | undefined): Promise<{ verdict: Verdict; feedback: string }> {
  return askJson(Grade, {
    system: `You grade a student's short answer to a quiz question against the expected answer. Judge the substance, not the wording or spelling: "correct" when it says what the expected answer says, "partial" when part of it is right or it is too vague, "incorrect" otherwise. The feedback is one or two sentences to the student, saying what was right and what was missing. Write the feedback in ${writeIn(language)}.`,
    prompt: `Question: ${q.question}\nExpected answer: ${q.answer}\nWhy: ${q.explanation}\n\nStudent's answer: ${response}`,
    shape: `{ "verdict": "correct" | "partial" | "incorrect", "feedback": string }`,
  });
}

interface Checked {
  score: number;
  feedback?: string;
}

type Phase = { name: "start" } | { name: "taking"; ids: string[]; index: number; deadline?: number } | { name: "done"; ids: string[] };

function View({ artifact, onChange }: ViewProps<QuizData>) {
  const { t } = useLang();
  const questions = artifact.data.questions;
  const [phase, setPhase] = useState<Phase>({ name: "start" });
  const [mode, setMode] = useState<"one" | "all">("one");
  const [timed, setTimed] = useState(false);
  const [responses, setResponses] = useState<Record<string, Response>>({});
  const [checked, setChecked] = useState<Record<string, Checked>>({});
  const [grading, setGrading] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const finishing = useRef(false);
  const byId = new Map(questions.map((q) => [q.id, q]));

  const record = (q: Question, score: number) =>
    void put("events", { ...fresh(), courseId: artifact.courseId, artifactId: artifact.id, kind: "quiz", concept: q.concept || undefined, score, at: Date.now() });

  const setResult = (q: Question, c: Checked) => {
    setChecked((m) => ({ ...m, [q.id]: c }));
    record(q, c.score);
  };

  const check = async (q: Question): Promise<Checked | undefined> => {
    const r = responses[q.id];
    if (r === undefined || (typeof r === "string" && !r.trim())) return undefined;
    if (q.kind !== "short") {
      const c = { score: scoreChoice(q, r) };
      setResult(q, c);
      return c;
    }
    setGrading((s) => new Set(s).add(q.id));
    setErrors((e) => ({ ...e, [q.id]: "" }));
    try {
      const g = await gradeShort(q, String(r), artifact.language);
      const c = { score: verdictScore(g.verdict), feedback: g.feedback };
      setResult(q, c);
      return c;
    } catch (e) {
      setErrors((x) => ({ ...x, [q.id]: e instanceof Error ? e.message : String(e) }));
      return undefined;
    } finally {
      setGrading((s) => {
        const n = new Set(s);
        n.delete(q.id);
        return n;
      });
    }
  };

  const start = (ids: string[]) => {
    finishing.current = false;
    setResponses({});
    setChecked({});
    setErrors({});
    const asked = ids.map((id) => byId.get(id)!);
    setPhase({ name: "taking", ids, index: 0, deadline: timed ? Date.now() + timeFor(asked) * 1000 : undefined });
  };

  const finish = async (ids: string[]) => {
    if (finishing.current) return;
    finishing.current = true;
    // Answers given but not checked yet count too.
    const scores: Record<string, number> = Object.fromEntries(Object.entries(checked).map(([id, c]) => [id, c.score]));
    for (const id of ids) {
      if (scores[id] !== undefined) continue;
      const c = await check(byId.get(id)!);
      if (c) scores[id] = c.score;
    }
    const asked = ids.map((id) => byId.get(id)!);
    const { points } = tally(asked, scores);
    // Only a full attempt counts as a result.
    if (ids.length === questions.length) onChange({ ...artifact.data, results: [...(artifact.data.results ?? []), { at: Date.now(), score: points, total: ids.length }].slice(-20) });
    setPhase({ name: "done", ids });
  };

  // The timer: a tick a second while a timed quiz runs, finishing at zero.
  const deadline = phase.name === "taking" ? phase.deadline : undefined;
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  useEffect(() => {
    if (phase.name === "taking" && deadline && now >= deadline) void finish(phase.ids);
  }, [now]);

  if (!questions.length) return <Notice kind="error">{t("This quiz has no questions.", "Ce quiz n'a pas de questions.", "Dieses Quiz hat keine Fragen.")}</Notice>;

  if (phase.name === "start") {
    const last = artifact.data.results?.at(-1);
    return (
      <div className="stack quiz">
        <p className="lead">
          {t(`${questions.length} questions`, `${questions.length} questions`, `${questions.length} Fragen`)}
          {last ? ` · ${t("last score", "dernier score", "letztes Ergebnis")} ${fmt(last.score)} / ${last.total}` : ""}
        </p>
        <Segmented
          label={t("How to take it", "Comment le passer", "Wie es ablaufen soll")}
          value={mode}
          onChange={setMode}
          options={[
            { id: "one", label: t("One question at a time", "Une question à la fois", "Eine Frage nach der anderen") },
            { id: "all", label: t("All at once", "Toutes à la fois", "Alle auf einmal") },
          ]}
        />
        <Segmented
          label={t("Time", "Temps", "Zeit")}
          value={timed ? "timed" : "free"}
          onChange={(v) => setTimed(v === "timed")}
          options={[
            { id: "free", label: t("Free", "Libre", "Frei") },
            { id: "timed", label: t(`Timed (${clock(timeFor(questions))})`, `Chronométré (${clock(timeFor(questions))})`, `Mit Zeitlimit (${clock(timeFor(questions))})`) },
          ]}
        />
        <div className="row">
          <button type="button" className="primary" onClick={() => start(questions.map((q) => q.id))}>
            <Icon name="play" size={18} /> {t("Start the quiz", "Commencer le quiz", "Quiz starten")}
          </button>
        </div>
      </div>
    );
  }

  if (phase.name === "done") {
    const asked = phase.ids.map((id) => byId.get(id)!);
    const scores = Object.fromEntries(Object.entries(checked).map(([id, c]) => [id, c.score]));
    const { points, total, ratio } = tally(asked, scores);
    const again = missed(asked, scores);
    return (
      <div className="stack quiz">
        <div className="quiz-score" role="status">
          <span className="quiz-score-value">
            {colon(t("Score", "Score", "Ergebnis"))} {fmt(points)} / {total}
          </span>
          <span className="meta">{Math.round(ratio * 100)} %</span>
        </div>
        <div className="row">
          {again.length ? (
            <button type="button" className="primary" onClick={() => start(again.map((q) => q.id))}>
              <Icon name="refresh" size={18} /> {t(`Retry the missed ones (${again.length})`, `Refaire les ratées (${again.length})`, `Die falschen wiederholen (${again.length})`)}
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={() => setPhase({ name: "start" })}>
            {t("Start over", "Recommencer", "Von vorn")}
          </button>
        </div>
        <ol className="quiz-review">
          {asked.map((q) => (
            <li key={q.id}>
              <QuestionCard q={q} artifact={artifact} response={responses[q.id]} checked={checked[q.id]} readOnly />
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const asked = phase.ids.map((id) => byId.get(id)!);
  const left = deadline ? Math.max(0, Math.round((deadline - now) / 1000)) : undefined;
  const card = (q: Question, i: number) => (
    <QuestionCard
      key={q.id}
      q={q}
      n={i + 1}
      of={asked.length}
      artifact={artifact}
      response={responses[q.id]}
      checked={checked[q.id]}
      grading={grading.has(q.id)}
      error={errors[q.id]}
      onRespond={(r) => setResponses((m) => ({ ...m, [q.id]: r }))}
      onCheck={() => void check(q)}
      onSelfGrade={(score) => setResult(q, { score })}
    />
  );
  return (
    <div className="stack quiz">
      <div className="row between">
        <span className="meta">
          {mode === "one" ? t(`Question ${phase.index + 1} of ${asked.length}`, `Question ${phase.index + 1} sur ${asked.length}`, `Frage ${phase.index + 1} von ${asked.length}`) : t(`${asked.length} questions`, `${asked.length} questions`, `${asked.length} Fragen`)}
        </span>
        {left !== undefined ? (
          <span className={`quiz-timer${left < 30 ? " low" : ""}`} role="timer" aria-label={t("Time left", "Temps restant", "Verbleibende Zeit")}>
            {clock(left)}
          </span>
        ) : null}
      </div>
      {mode === "one" ? (
        <>
          {card(asked[phase.index]!, phase.index)}
          <div className="row end">
            {phase.index + 1 < asked.length ? (
              <button type="button" className={checked[asked[phase.index]!.id] ? "primary" : "secondary"} onClick={() => setPhase({ ...phase, index: phase.index + 1 })}>
                {checked[asked[phase.index]!.id] ? t("Next question", "Question suivante", "Nächste Frage") : t("Skip", "Passer", "Überspringen")} <Icon name="chevron-right" size={18} />
              </button>
            ) : (
              <button type="button" className="primary" onClick={() => void finish(phase.ids)}>
                {t("See the score", "Voir le score", "Ergebnis anzeigen")}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <ol className="quiz-all">{asked.map((q, i) => <li key={q.id}>{card(q, i)}</li>)}</ol>
          <div className="row end">
            <button type="button" className="primary" onClick={() => void finish(phase.ids)}>
              {t("Finish and see the score", "Terminer et voir le score", "Beenden und Ergebnis anzeigen")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function QuestionCard({
  q,
  n,
  of,
  artifact,
  response,
  checked,
  grading,
  error,
  readOnly,
  onRespond,
  onCheck,
  onSelfGrade,
}: {
  q: Question;
  n?: number;
  of?: number;
  artifact: Artifact<QuizData>;
  response?: Response;
  checked?: Checked;
  grading?: boolean;
  error?: string;
  readOnly?: boolean;
  onRespond?: (r: Response) => void;
  onCheck?: () => void;
  onSelfGrade?: (score: number) => void;
}) {
  const { t } = useLang();
  const locked = readOnly || Boolean(checked) || grading;
  const name = `quiz-${artifact.id}-${q.id}`;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!locked) onCheck?.();
  };
  const choices = q.kind === "mcq" ? q.choices : q.kind === "truefalse" ? [t("True", "Vrai", "Wahr"), t("False", "Faux", "Falsch")] : [];
  const valueOf = (i: number): Response => (q.kind === "truefalse" ? i === 0 : i);
  const verdict = checked ? verdictOf(checked.score) : undefined;
  const cite = (l: string) => openCitation(l, artifact.sourceIds);
  return (
    <form className={`quiz-card${verdict ? ` ${verdict}` : ""}`} onSubmit={submit} aria-label={n ? t(`Question ${n} of ${of}`, `Question ${n} sur ${of}`, `Frage ${n} von ${of}`) : undefined}>
      <fieldset disabled={locked}>
        <legend className="quiz-question">{q.question}</legend>
        {q.kind === "short" ? (
          <textarea
            rows={3}
            value={typeof response === "string" ? response : ""}
            onChange={(e) => onRespond?.(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e);
            }}
            aria-label={t("Your answer", "Votre réponse", "Ihre Antwort")}
            placeholder={t("Your answer (Ctrl+Enter to check)", "Votre réponse (Ctrl+Entrée pour vérifier)", "Ihre Antwort (Strg+Eingabe zum Prüfen)")}
          />
        ) : (
          <div className="quiz-choices">
            {choices.map((c, i) => {
              const v = valueOf(i);
              const right = checked && v === q.answer;
              const wrong = checked && response === v && v !== q.answer;
              return (
                <label key={c + String(i)} className={`quiz-choice${right ? " right" : ""}${wrong ? " wrong" : ""}`}>
                  <input type="radio" name={name} checked={response === v} onChange={() => onRespond?.(v)} />
                  {q.kind === "mcq" ? <span className="quiz-letter">{String.fromCharCode(65 + i)}</span> : null}
                  <span>{c}</span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
      {!readOnly && !checked ? (
        <div className="row">
          <button type="submit" className="secondary" disabled={grading || response === undefined || (typeof response === "string" && !response.trim())}>
            {grading ? t("Grading…", "Correction…", "Wird bewertet…") : t("Check", "Vérifier", "Prüfen")}
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="stack">
          <Notice kind="error">{error}</Notice>
          <div className="row">
            <span className="meta">{t("Grade it yourself:", "Corrigez vous-même :", "Selbst bewerten:")}</span>
            <button type="button" className="small" onClick={() => onSelfGrade?.(1)}>
              {t("I was right", "J'avais juste", "Ich lag richtig")}
            </button>
            <button type="button" className="small" onClick={() => onSelfGrade?.(0)}>
              {t("I was wrong", "Je m'étais trompé", "Ich lag falsch")}
            </button>
          </div>
        </div>
      ) : null}
      {checked || readOnly ? (
        <div className="quiz-feedback" role={readOnly ? undefined : "status"}>
          <p className="quiz-verdict">
            {verdict === "correct" ? (
              <>
                <Icon name="check" size={18} /> {t("Correct", "Juste", "Richtig")}
              </>
            ) : verdict === "partial" ? (
              t("Partly right", "En partie juste", "Teilweise richtig")
            ) : verdict === "incorrect" ? (
              <>
                <Icon name="x" size={18} /> {t("Not quite", "Pas tout à fait", "Nicht ganz")}
              </>
            ) : (
              t("Not answered", "Sans réponse", "Nicht beantwortet")
            )}
          </p>
          {readOnly && q.kind === "short" && typeof response === "string" && response ? (
            <p className="meta">
              {colon(t("Your answer", "Votre réponse", "Ihre Antwort"))} {response}
            </p>
          ) : null}
          {verdict !== "correct" || q.kind === "short" ? (
            <p>
              {colon(t("Answer", "Réponse", "Antwort"))} <strong>{answerText(q, t)}</strong>
            </p>
          ) : null}
          {checked?.feedback ? <p>{checked.feedback}</p> : null}
          {q.explanation ? <Markdown text={q.explanation} onCite={cite} /> : null}
          {q.cite && !q.explanation.includes(`[${q.cite}]`) ? (
            <p>
              <button type="button" className="cite" onClick={() => cite(q.cite!)}>
                {q.cite}
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

export const quiz = kind<QuizData, QuizOptions>({
  type: "quiz",
  icon: "quiz",
  label: (t) => t("Quiz", "Quiz", "Quiz"),
  blurb: (t) => t("Multiple choice, true or false, short answers, with the explanations", "QCM, vrai ou faux, réponses courtes, avec les explications", "Multiple Choice, richtig oder falsch, kurze Antworten, mit Erklärungen"),
  defaults: { count: 10, kinds: "mixed", difficulty: "medium", focus: "" },
  Options,
  sends: (t, o) =>
    o.kinds === "mixed" || o.kinds === "short"
      ? t("Your short answers are sent too, to be graded.", "Vos réponses courtes le sont aussi, pour être corrigées.", "Ihre kurzen Antworten werden ebenfalls zur Bewertung gesendet.")
      : null,
  async generate(ctx, o) {
    ctx.progress({ label: "" });
    const concepts = conceptRule((await list("concepts", "courseId", ctx.course.id)).sort((a, b) => a.order - b.order));
    const context = buildContext(ctx.sources, { query: o.focus || undefined, budget: budgetFor(capabilities().contextWindow) });
    const questions = await askJson(QuizAnswer, {
      system: `You write a quiz for a university student from their own course sources. Write ${o.count} questions; ${KIND_RULE[o.kinds]}; difficulty ${DIFFICULTY_RULE[o.difficulty]}. Each question tests one concept, named in "concept" (1 to 4 words, the same name for questions on the same concept). Multiple choice: 4 plausible choices, exactly one right, "answer" is its 0-based index. True/false: "answer" is true or false. Short answer: "answer" is the expected answer in a few words or one sentence. "explanation" says why in one to three sentences and cites the passages with their labels in square brackets, e.g. [S1 p.3]; "cite" is the main label. Use only labels that appear in the sources and only what the sources say. Write in ${writeIn(ctx.language)}.${concepts}`,
      prompt: `${o.focus ? `Focus on: ${o.focus}\n\n` : ""}${context.text}`,
      shape: SHAPE,
      signal: ctx.signal,
    });
    const l = trIn(ctx.language);
    return { title: `${l("Quiz", "Quiz", "Quiz")} · ${ctx.lesson?.title ?? ctx.course.title}`, data: { questions: questions.slice(0, o.count) } };
  },
  View,
  exports: [
    {
      id: "md",
      label: (t) => t("Markdown (questions and answers)", "Markdown (questions et réponses)", "Markdown (Fragen und Antworten)"),
      run: async (a) => ({ blob: new Blob([quizMarkdown(a.title, a.data.questions, trIn(a.language))], { type: "text/markdown" }), filename: `${slug(a.title)}.md` }),
    },
  ],
});
