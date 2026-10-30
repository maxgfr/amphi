import { lazy, Suspense, useState } from "react";
import { get, list, removeLesson, update } from "../data/db.ts";
import { useLive } from "../data/hooks.ts";
import { useLang } from "../i18n.ts";
import { go, href } from "../router.ts";
import { Icon } from "../ui/icons.tsx";
import { Empty, Tabs } from "../ui/kit.tsx";
import { SourceList } from "./sources.tsx";

const StudioPanel = lazy(() => import("../studio/panel.tsx").then((m) => ({ default: m.StudioPanel })));
const ChatPanel = lazy(() => import("../chat/panel.tsx").then((m) => ({ default: m.ChatPanel })));

type Tab = "sources" | "studio" | "chat";

export function LessonScreen({ id, tab }: { id: string; tab?: string }) {
  const { t } = useLang();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const data = useLive(
    async () => {
      const lesson = await get("lessons", id);
      if (!lesson) return null;
      const course = await get("courses", lesson.courseId);
      const sources = (await list("sources", "lessonId", id)).sort((a, b) => a.createdAt - b.createdAt);
      return { lesson, course, sources };
    },
    ["lessons", "courses", "sources"],
    [id],
  );
  if (data === undefined) return <div className="page" aria-busy="true" />;
  if (data === null || !data.course)
    return (
      <div className="page">
        <Empty icon="layers" title={t("This lesson no longer exists.", "Cette séance n'existe plus.", "Diese Sitzung existiert nicht mehr.")}>
          <a href={href.courses()}>{t("Back to courses", "Retour aux cours", "Zurück zu den Kursen")}</a>
        </Empty>
      </div>
    );
  const { lesson, course, sources } = data;
  const current: Tab = (["sources", "studio", "chat"] as const).includes(tab as Tab) ? (tab as Tab) : "sources";
  return (
    <div className="page">
      <nav className="crumbs" aria-label={t("Breadcrumb", "Fil d'Ariane", "Brotkrumen")}>
        <a href={href.courses()}>{t("Courses", "Cours", "Kurse")}</a>
        <a href={href.course(course.id)}>{course.title}</a>
      </nav>
      <div className="page-head">
        <input
          className="title-input"
          aria-label={t("Lesson title", "Titre de la séance", "Titel der Sitzung")}
          defaultValue={lesson.title}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v && v !== lesson.title) void update("lessons", id, { title: v });
          }}
        />
        <div className="row">
          <input
            type="date"
            aria-label={t("Date", "Date", "Datum")}
            defaultValue={lesson.date}
            onChange={(e) => void update("lessons", id, { date: e.currentTarget.value || undefined })}
          />
          {confirmDelete ? (
            <button
              type="button"
              className="danger"
              onClick={async () => {
                await removeLesson(id);
                go(href.course(course.id));
              }}
            >
              {t("Delete for good", "Supprimer définitivement", "Endgültig löschen")}
            </button>
          ) : (
            <button type="button" className="icon-button" aria-label={t("Delete the lesson", "Supprimer la séance", "Sitzung löschen")} onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={18} />
            </button>
          )}
        </div>
      </div>
      <Tabs
        tabs={[
          { id: "sources", label: t("Sources", "Sources", "Quellen"), icon: "file", count: sources.length },
          { id: "studio", label: t("Studio", "Studio", "Studio"), icon: "sparkle" },
          { id: "chat", label: t("Chat", "Chat", "Chat"), icon: "chat" },
        ]}
        value={current}
        onChange={(k) => go(href.lesson(id, k))}
        label={t("Lesson sections", "Sections de la séance", "Bereiche der Sitzung")}
      />
      <div className="tab-panel" role="tabpanel">
        {current === "sources" ? <SourceList sources={sources} courseId={course.id} lessonId={id} /> : null}
        <Suspense fallback={<div aria-busy="true" />}>
          {current === "studio" ? <StudioPanel courseId={course.id} lessonId={id} /> : null}
          {current === "chat" ? <ChatPanel courseId={course.id} lessonId={id} /> : null}
        </Suspense>
      </div>
    </div>
  );
}
