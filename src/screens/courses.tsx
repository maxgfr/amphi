import { useState } from "react";
import { list } from "../data/db.ts";
import { useLive } from "../data/hooks.ts";
import type { Course } from "../data/schema.ts";
import { count, dateOnly, type T, useLang } from "../i18n.ts";
import { go, href } from "../router.ts";
import { daysUntil } from "../learn/next.ts";
import { courseHue } from "../ui/hue.ts";
import { Icon } from "../ui/icons.tsx";
import { Empty } from "../ui/kit.tsx";
import { CourseForm } from "./course-form.tsx";

export interface CourseSummary {
  course: Course;
  lessons: number;
  sources: number;
  artifacts: number;
}

export async function courseSummaries(): Promise<CourseSummary[]> {
  const [courses, lessons, sources, artifacts] = await Promise.all([list("courses"), list("lessons"), list("sources"), list("artifacts")]);
  const count = (rows: { courseId: string }[], id: string) => rows.reduce((n, r) => n + (r.courseId === id ? 1 : 0), 0);
  return courses
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((course) => ({ course, lessons: count(lessons, course.id), sources: count(sources, course.id), artifacts: count(artifacts, course.id) }));
}

export function examLabel(date: string, t: T): string {
  const days = daysUntil(date);
  if (days === 0) return t("Exam today", "Examen aujourd'hui", "Prüfung heute");
  if (days > 0) {
    const n = count(days, ["day", "days"], ["jour", "jours"], ["Tag", "Tagen"]);
    return t(`Exam in ${n}`, `Examen dans ${n}`, `Prüfung in ${n}`);
  }
  return `${t("Exam", "Examen", "Prüfung")} ${dateOnly(new Date(date).getTime())}`;
}

/** "3 lessons" with the number set apart; a zero stays quiet. */
function Counted({ n, text }: { n: number; text: string }) {
  const i = text.indexOf(" ");
  return (
    <span className={n ? "binder-count" : "binder-count zero"}>
      <strong>{text.slice(0, i)}</strong> {text.slice(i + 1)}
    </span>
  );
}

/** The courses as a binder's dividers: a coloured tab per course, its tabs stepping across like a real set. */
export function Binder({ rows }: { rows: CourseSummary[] }) {
  const { t } = useLang();
  return (
    <ol className="binder">
      {rows.map(({ course, lessons, sources, artifacts }) => (
        <li key={course.id} data-hue={courseHue(course)}>
          <a className="binder-link" href={href.course(course.id)}>
            <span className="binder-tab">
              {course.emoji ? <span aria-hidden="true">{course.emoji}</span> : null}
              <span>{course.title}</span>
            </span>
            <span className="binder-body">
              {course.examDate ? <span className="binder-exam">{examLabel(course.examDate, t)}</span> : null}
              {course.kind === "topic" ? <span className="binder-kind">{t("Topic", "Sujet", "Thema")}</span> : null}
              <span className="binder-counts">
                {course.kind === "course" ? <Counted n={lessons} text={count(lessons, ["lesson", "lessons"], ["séance", "séances"], ["Sitzung", "Sitzungen"])} /> : null}
                <Counted n={sources} text={count(sources, ["source", "sources"], ["source", "sources"], ["Quelle", "Quellen"])} />
                <Counted n={artifacts} text={count(artifacts, ["study aid", "study aids"], ["création", "créations"], ["Lernhilfe", "Lernhilfen"])} />
              </span>
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}

export function Courses() {
  const { t } = useLang();
  const [creating, setCreating] = useState(false);
  const rows = useLive(courseSummaries, ["courses", "lessons", "sources", "artifacts"], []);
  const courses = rows?.filter((r) => r.course.kind === "course") ?? [];
  const topics = rows?.filter((r) => r.course.kind === "topic") ?? [];
  return (
    <div className="page">
      <div className="page-head">
        <h1>{t("Courses", "Cours", "Kurse")}</h1>
        <button type="button" className="primary" onClick={() => setCreating(true)}>
          <Icon name="plus" /> {t("New course", "Nouveau cours", "Neuer Kurs")}
        </button>
      </div>
      {rows && !rows.length ? (
        <Empty icon="book" title={t("No course yet", "Aucun cours pour l'instant", "Noch kein Kurs")}>
          <p>{t("Create a course, then add your lectures: PDFs, notes, recordings.", "Créez un cours, puis ajoutez vos séances : PDF, notes, enregistrements.", "Erstellen Sie einen Kurs und fügen Sie dann Ihre Vorlesungen hinzu: PDFs, Notizen, Aufnahmen.")}</p>
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            {t("Create a course", "Créer un cours", "Kurs erstellen")}
          </button>
        </Empty>
      ) : null}
      {courses.length ? <Binder rows={courses} /> : null}
      {topics.length ? (
        <>
          <h2 className="section-title">{t("Topics you are discovering", "Sujets en découverte", "Themen, die Sie entdecken")}</h2>
          <Binder rows={topics} />
        </>
      ) : null}
      {creating ? <CourseForm open onClose={() => setCreating(false)} onSaved={(c) => go(href.course(c.id))} /> : null}
    </div>
  );
}
