// One Studio artifact: shown and edited by its type's View, exported,
// regenerated as a new version, or deleted.

import { useState } from "react";
import { get, list, remove, update } from "../data/db.ts";
import { useLive } from "../data/hooks.ts";
import type { Artifact } from "../data/schema.ts";
import { relative, useLang } from "../i18n.ts";
import { go, href } from "../router.ts";
import { hasText, MakeSheet } from "../studio/panel.tsx";
import { studioKind } from "../studio/registry.ts";
import { cancelJob, useJobs } from "../studio/run.ts";
import { Icon } from "../ui/icons.tsx";
import { Empty, Notice, ProgressBar, saveFile } from "../ui/kit.tsx";

export function ArtifactScreen({ id }: { id: string }) {
  const { t } = useLang();
  const jobs = useJobs();
  const [regenerating, setRegenerating] = useState(false);
  const [exporting, setExporting] = useState("");
  const [error, setError] = useState("");
  const data = useLive(
    async () => {
      const artifact = await get("artifacts", id);
      if (!artifact) return null;
      const [course, lesson, all] = await Promise.all([get("courses", artifact.courseId), artifact.lessonId ? get("lessons", artifact.lessonId) : undefined, list("sources", "courseId", artifact.courseId)]);
      return { artifact, course, lesson, all };
    },
    ["artifacts", "sources"],
    [id],
  );
  if (data === undefined) return <div className="page" aria-busy="true" />;
  if (data === null || !data.course)
    return (
      <div className="page">
        <Empty icon="sparkle" title={t("This no longer exists.", "Ceci n'existe plus.", "Dies existiert nicht mehr.")} />
      </div>
    );
  const { artifact, course, lesson, all } = data;
  const k = studioKind(artifact.type);
  const job = jobs.find((j) => j.artifactId === id);
  const sources = artifact.sourceIds.map((sid) => all.find((s) => s.id === sid)).filter((s) => s !== undefined);
  const scope = all.filter((s) => (!artifact.lessonId || s.lessonId === artifact.lessonId) && hasText(s));
  const View = k?.View;
  return (
    <div className="page">
      <nav className="crumbs no-print" aria-label={t("Breadcrumb", "Fil d'Ariane", "Brotkrumen")}>
        <a href={href.course(course.id, "studio")}>{course.title}</a>
        {lesson ? <a href={href.lesson(lesson.id, "studio")}>{lesson.title}</a> : null}
      </nav>
      <div className="page-head">
        <input
          className="title-input"
          aria-label={t("Title", "Titre", "Titel")}
          defaultValue={artifact.title}
          key={artifact.title}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v && v !== artifact.title) void update("artifacts", id, { title: v });
          }}
        />
        <div className="row no-print">
          {k && artifact.status !== "working" ? (
            <button type="button" className="secondary" onClick={() => setRegenerating(true)}>
              <Icon name="refresh" size={18} /> {t("Regenerate", "Régénérer", "Neu erstellen")}
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            aria-label={t("Delete", "Supprimer", "Löschen")}
            onClick={async () => {
              await remove("artifacts", id);
              go(artifact.lessonId ? href.lesson(artifact.lessonId, "studio") : href.course(course.id, "studio"));
            }}
          >
            <Icon name="trash" size={18} />
          </button>
        </div>
      </div>
      <p className="meta no-print">
        {k?.label(t)} · {relative(artifact.updatedAt)} · v{artifact.version} · {t("from", "à partir de", "aus")} {sources.map((s) => s.title).join(", ") || "—"}
      </p>
      {artifact.status === "working" ? (
        job ? (
          <div className="stack">
            <ProgressBar ratio={job.progress.ratio} label={job.progress.label || t("Generating…", "Génération…", "Wird erstellt…")} />
            <p className="meta" role="status">
              {job.progress.label || t("Generating…", "Génération…", "Wird erstellt…")}
            </p>
            <div className="row">
              <button type="button" className="secondary" onClick={() => cancelJob(id)}>
                {t("Cancel", "Annuler", "Abbrechen")}
              </button>
            </div>
          </div>
        ) : (
          <Notice kind="error">{t("The generation was interrupted (the page closed). Regenerate it.", "La génération a été interrompue (la page s'est fermée). Régénérez-la.", "Die Erstellung wurde unterbrochen (die Seite wurde geschlossen). Erstellen Sie sie neu.")}</Notice>
        )
      ) : null}
      {artifact.status === "error" ? <Notice kind="error">{artifact.error}</Notice> : null}
      {artifact.status === "ready" && View ? (
        <>
          {k.exports?.length ? (
            <div className="row wrap no-print" aria-label={t("Export", "Exporter", "Exportieren")}>
              {k.exports.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className="secondary"
                  disabled={exporting === x.id}
                  onClick={async () => {
                    setExporting(x.id);
                    setError("");
                    try {
                      const file = await x.run(artifact, { course, lesson, sources });
                      if (file) saveFile(file.blob, file.filename);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setExporting("");
                    }
                  }}
                >
                  <Icon name="download" size={18} /> {x.label(t)}
                </button>
              ))}
            </div>
          ) : null}
          {error ? <Notice kind="error">{error}</Notice> : null}
          <View artifact={artifact as Artifact<never>} course={course} sources={sources} onChange={(d) => void update("artifacts", id, { data: d })} />
        </>
      ) : null}
      {regenerating && k ? <MakeSheet k={k} sources={scope} courseId={course.id} lessonId={artifact.lessonId} replace={artifact} onClose={() => setRegenerating(false)} /> : null}
    </div>
  );
}
