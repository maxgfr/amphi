import { lazy, Suspense, useState } from "react";
import { fresh, get, list, put, removeCourse } from "../data/db.ts";
import { useLive } from "../data/hooks.ts";
import { count, dateOnly, useLang } from "../i18n.ts";
import { go, href } from "../router.ts";
import { courseHue, useOpenCourse } from "../ui/hue.ts";
import { Icon } from "../ui/icons.tsx";
import { Empty, Notice, saveFile, Tabs } from "../ui/kit.tsx";
import { CourseForm } from "./course-form.tsx";
import { examLabel } from "./courses.tsx";
import { SourceList } from "./sources.tsx";

const StudioPanel = lazy(() => import("../studio/panel.tsx").then((m) => ({ default: m.StudioPanel })));
const ChatPanel = lazy(() => import("../chat/panel.tsx").then((m) => ({ default: m.ChatPanel })));
const ProgressPanel = lazy(() => import("../learn/panel.tsx").then((m) => ({ default: m.ProgressPanel })));

type Tab = "lessons" | "sources" | "studio" | "chat" | "progress";

export function CourseScreen({ id, tab }: { id: string; tab?: string }) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  useOpenCourse(id);
  const data = useLive(
    async () => {
      const course = await get("courses", id);
      if (!course) return null;
      const [lessons, sources] = await Promise.all([list("lessons", "courseId", id), list("sources", "courseId", id)]);
      return { course, lessons: lessons.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt), sources: sources.sort((a, b) => a.createdAt - b.createdAt) };
    },
    ["courses", "lessons", "sources"],
    [id],
  );
  if (data === undefined) return <div className="page" aria-busy="true" />;
  if (data === null)
    return (
      <div className="page">
        <Empty icon="book" title={t("This course no longer exists.", "Ce cours n'existe plus.", "Dieser Kurs existiert nicht mehr.")}>
          <a href={href.courses()}>{t("Back to courses", "Retour aux cours", "Zurück zu den Kursen")}</a>
        </Empty>
      </div>
    );
  const { course, lessons, sources } = data;
  const current: Tab = (["lessons", "sources", "studio", "chat", "progress"] as const).includes(tab as Tab) ? (tab as Tab) : course.kind === "topic" ? "sources" : "lessons";
  const tabs = [
    ...(course.kind === "course" ? [{ id: "lessons" as const, label: t("Lessons", "Séances", "Sitzungen"), icon: "layers" as const, count: lessons.length }] : []),
    { id: "sources" as const, label: t("Sources", "Sources", "Quellen"), icon: "file" as const, count: sources.length },
    { id: "studio" as const, label: t("Studio", "Studio", "Studio"), icon: "sparkle" as const },
    { id: "chat" as const, label: t("Chat", "Chat", "Chat"), icon: "chat" as const },
    { id: "progress" as const, label: t("Progress", "Progression", "Fortschritt"), icon: "target" as const },
  ];

  const addLesson = async () => {
    const n = lessons.length + 1;
    const lesson = await put("lessons", { ...fresh(), courseId: id, title: t(`Lesson ${n}`, `Séance ${n}`, `Sitzung ${n}`), date: new Date().toISOString().slice(0, 10), order: n });
    go(href.lesson(lesson.id));
  };

  return (
    <div className="page" data-hue={courseHue(id)}>
      <header className="divider">
        <nav className="crumbs" aria-label={t("Breadcrumb", "Fil d'Ariane", "Brotkrumen")}>
          <a href={href.courses()}>{t("Courses", "Cours", "Kurse")}</a>
        </nav>
        <div className="page-head">
          <h1>
            <span aria-hidden="true">{course.emoji || (course.kind === "topic" ? "🧭" : "📘")}</span> {course.title}
          </h1>
          <div className="row">
            <button
              type="button"
              className="secondary"
              disabled={sending}
              title={t("A .cursus-course file with the sources, reports and flashcards, to import in Cursus", "Un fichier .cursus-course avec les sources, rapports et cartes, à importer dans Cursus", "Eine .cursus-course-Datei mit den Quellen, Berichten und Karten, zum Import in Cursus")}
              onClick={async () => {
                setSending(true);
                setSendError("");
                try {
                  const file = await (await import("../export/cursus.ts")).courseToCursus(id);
                  saveFile(file.blob, file.filename);
                } catch (e) {
                  setSendError(e instanceof Error ? e.message : String(e));
                } finally {
                  setSending(false);
                }
              }}
            >
              <Icon name="send" size={18} /> {t("Send to Cursus", "Envoyer vers Cursus", "An Cursus senden")}
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(true)}>
              <Icon name="edit" size={18} /> {t("Edit", "Modifier", "Bearbeiten")}
            </button>
            {confirmDelete ? (
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  await removeCourse(id);
                  go(href.courses());
                }}
              >
                {t("Delete for good", "Supprimer définitivement", "Endgültig löschen")}
              </button>
            ) : (
              <button type="button" className="icon-button" aria-label={t("Delete the course", "Supprimer le cours", "Kurs löschen")} onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" size={18} />
              </button>
            )}
          </div>
        </div>
        {sendError ? <Notice kind="error">{sendError}</Notice> : null}
        {course.examDate ? <p className="divider-facts">{examLabel(course.examDate, t)} · {dateOnly(new Date(course.examDate).getTime())}</p> : null}
        <Tabs tabs={tabs} value={current} onChange={(k) => go(href.course(id, k))} label={t("Course sections", "Sections du cours", "Kursbereiche")} />
      </header>
      <div className="tab-panel" role="tabpanel">
        {current === "lessons" ? (
          <section className="stack">
            <div className="row">
              <button type="button" className="primary" onClick={() => void addLesson()}>
                <Icon name="plus" /> {t("New lesson", "Nouvelle séance", "Neue Sitzung")}
              </button>
              <a className="button secondary" href={href.record(id)}>
                <Icon name="mic" /> {t("Record a lecture", "Enregistrer un cours", "Vorlesung aufnehmen")}
              </a>
            </div>
            {lessons.length ? (
              <ol className="list">
                {lessons.map((l) => {
                  const n = sources.filter((s) => s.lessonId === l.id).length;
                  return (
                    <li key={l.id} className="list-item">
                      <a className="list-link" href={href.lesson(l.id)}>
                        <span className="list-main">
                          <span className="list-title">{l.title}</span>
                          <span className="meta">{count(n, ["source", "sources"], ["source", "sources"], ["Quelle", "Quellen"])}</span>
                        </span>
                        {l.date ? <span className="list-end">{dateOnly(new Date(l.date).getTime())}</span> : null}
                        <Icon name="chevron-right" />
                      </a>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <Empty icon="layers" title={t("No lesson yet", "Aucune séance", "Noch keine Sitzung")}>
                <p>{t("One lesson per lecture: its slides, notes and recording.", "Une séance par cours magistral : ses diapos, notes et enregistrement.", "Eine Sitzung pro Vorlesung: Folien, Notizen und Aufnahme.")}</p>
              </Empty>
            )}
          </section>
        ) : null}
        {current === "sources" ? <SourceList sources={sources} courseId={id} /> : null}
        <Suspense fallback={<div aria-busy="true" />}>
          {current === "studio" ? <StudioPanel courseId={id} /> : null}
          {current === "chat" ? <ChatPanel courseId={id} /> : null}
          {current === "progress" ? <ProgressPanel courseId={id} /> : null}
        </Suspense>
      </div>
      {editing ? <CourseForm open course={course} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
