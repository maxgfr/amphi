import { useState } from "react";
import { list } from "../data/db.ts";
import { useLive } from "../data/hooks.ts";
import type { Course } from "../data/schema.ts";
import { count, dateOnly, useLang } from "../i18n.ts";
import { go, href } from "../router.ts";
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

export function CourseCard({ s }: { s: CourseSummary }) {
  const { t } = useLang();
  const { course } = s;
  return (
    <a className="card course-card" href={href.course(course.id)}>
      <span className="course-emoji" aria-hidden="true">
        {course.emoji || (course.kind === "topic" ? "🧭" : "📘")}
      </span>
      <span className="course-title">{course.title}</span>
      <span className="meta">
        {course.kind === "topic" ? t("Topic", "Sujet", "Thema") : count(s.lessons, ["lesson", "lessons"], ["séance", "séances"], ["Sitzung", "Sitzungen"])} · {count(s.sources, ["source", "sources"], ["source", "sources"], ["Quelle", "Quellen"])}
        {course.examDate ? ` · ${t("exam", "examen", "Prüfung")} ${dateOnly(new Date(course.examDate).getTime())}` : ""}
      </span>
    </a>
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
      {courses.length ? (
        <div className="grid">
          {courses.map((s) => (
            <CourseCard key={s.course.id} s={s} />
          ))}
        </div>
      ) : null}
      {topics.length ? (
        <>
          <h2 className="section-title">{t("Topics you are discovering", "Sujets en découverte", "Themen, die Sie entdecken")}</h2>
          <div className="grid">
            {topics.map((s) => (
              <CourseCard key={s.course.id} s={s} />
            ))}
          </div>
        </>
      ) : null}
      {creating ? <CourseForm open onClose={() => setCreating(false)} onSaved={(c) => go(href.course(c.id))} /> : null}
    </div>
  );
}
