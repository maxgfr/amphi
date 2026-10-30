// The Studio of a course or a lesson: pick what to make, from which sources,
// see what is sent and to whom, then follow the generations and open what
// they produced.

import { useState } from "react";
import { loadLlm, recipient, savedSettings } from "../ai/llm.ts";
import { list } from "../data/db.ts";
import { useLive } from "../data/hooks.ts";
import type { Artifact, Id, Source } from "../data/schema.ts";
import { relative, useLang } from "../i18n.ts";
import { href } from "../router.ts";
import { Icon } from "../ui/icons.tsx";
import { Empty, Notice, ProgressBar, Sheet } from "../ui/kit.tsx";
import { STUDIO, studioKind } from "./registry.ts";
import { cancelJob, runStudio, useJobs } from "./run.ts";
import type { StudioKind } from "./types.ts";

export function StudioPanel({ courseId, lessonId }: { courseId: Id; lessonId?: Id }) {
  const { t } = useLang();
  const [making, setMaking] = useState<StudioKind | null>(null);
  const jobs = useJobs();
  const data = useLive(
    async () => {
      await loadLlm();
      const [sources, artifacts] = await Promise.all([list("sources", "courseId", courseId), list("artifacts", "courseId", courseId)]);
      return {
        sources: sources.filter((s) => (!lessonId || s.lessonId === lessonId) && hasText(s)).sort((a, b) => a.createdAt - b.createdAt),
        artifacts: artifacts.filter((a) => !lessonId || a.lessonId === lessonId).sort((a, b) => b.updatedAt - a.updatedAt),
        configured: Boolean(savedSettings()),
      };
    },
    ["sources", "artifacts"],
    [courseId, lessonId],
  );
  if (!data) return <div aria-busy="true" />;
  return (
    <section className="studio">
      {!data.configured ? (
        <Notice>
          {t("The Studio uses your own AI provider.", "Le Studio utilise votre propre fournisseur d'IA.", "Das Studio nutzt Ihren eigenen KI-Anbieter.")} <a href={href.settings("ai")}>{t("Set one up", "En configurer un", "Einen einrichten")}</a>
        </Notice>
      ) : null}
      {!data.sources.length ? (
        <Notice>{t("Add sources first (PDF, notes, a transcribed recording): everything here is made from them.", "Ajoutez d'abord des sources (PDF, notes, un enregistrement transcrit) : tout ici est fait à partir d'elles.", "Fügen Sie zuerst Quellen hinzu (PDF, Notizen, eine transkribierte Aufnahme): Alles hier entsteht aus ihnen.")}</Notice>
      ) : null}
      <div className="studio-grid">
        {STUDIO.map((k) => (
          <button key={k.type} type="button" className="studio-tile" disabled={!data.configured || !data.sources.length} onClick={() => setMaking(k)}>
            <Icon name={k.icon} size={22} />
            <span className="tile-title">{k.label(t)}</span>
            <span className="meta">{k.blurb(t)}</span>
          </button>
        ))}
      </div>
      <h2 className="section-title">{t("Made in this Studio", "Réalisé dans ce Studio", "In diesem Studio erstellt")}</h2>
      {data.artifacts.length ? (
        <ul className="list">
          {data.artifacts.map((a) => (
            <ArtifactRow key={a.id} artifact={a} job={jobs.find((j) => j.artifactId === a.id)} />
          ))}
        </ul>
      ) : (
        <Empty icon="sparkle" title={t("Nothing yet", "Rien pour l'instant", "Noch nichts")} />
      )}
      {making ? <MakeSheet k={making} sources={data.sources} courseId={courseId} lessonId={lessonId} onClose={() => setMaking(null)} /> : null}
    </section>
  );
}

export const hasText = (s: Source) => s.status === "ready" && Boolean(s.pages?.some((p) => p.text.trim()) || s.text?.trim() || s.transcript?.segments.length);

function ArtifactRow({ artifact: a, job }: { artifact: Artifact; job?: ReturnType<typeof useJobs>[number] }) {
  const { t } = useLang();
  const k = studioKind(a.type);
  const label = k?.label(t) ?? a.type;
  return (
    <li className="list-item">
      <a className="list-link" href={href.artifact(a.id)}>
        <Icon name={k?.icon ?? "sparkle"} />
        <span className="list-main">
          <span className="list-title">{a.title || label}</span>
          <span className="meta">
            {label} · {relative(a.updatedAt)}
            {a.version > 1 ? ` · v${a.version}` : ""}
          </span>
          {a.status === "working" ? (
            job ? (
              <ProgressBar ratio={job.progress.ratio} label={job.progress.label || t("Generating…", "Génération…", "Wird erstellt…")} />
            ) : (
              <span className="meta">{t("Interrupted: open it to try again.", "Interrompu : ouvrez-le pour réessayer.", "Unterbrochen: Öffnen Sie es, um es erneut zu versuchen.")}</span>
            )
          ) : null}
          {job?.progress.label ? <span className="meta">{job.progress.label}</span> : null}
          {a.status === "error" ? <span className="error-text">{a.error}</span> : null}
        </span>
      </a>
      {job ? (
        <button type="button" className="secondary small" onClick={() => cancelJob(a.id)}>
          {t("Cancel", "Annuler", "Abbrechen")}
        </button>
      ) : null}
    </li>
  );
}

export function MakeSheet({ k, sources, courseId, lessonId, onClose, replace }: { k: StudioKind; sources: Source[]; courseId: Id; lessonId?: Id; onClose: () => void; replace?: Artifact }) {
  const { t } = useLang();
  const [options, setOptions] = useState<Record<string, unknown>>({ ...k.defaults, ...replace?.options });
  const [chosen, setChosen] = useState<Set<Id>>(() => new Set(replace?.sourceIds.filter((id) => sources.some((s) => s.id === id)) ?? sources.map((s) => s.id)));
  const [error, setError] = useState("");
  const problem = k.problem?.(t) ?? null;
  const extra = k.sends?.(t, options as never) ?? null;
  const to = recipient();
  const Options = k.Options;
  return (
    <Sheet open onClose={onClose} title={k.label(t)} wide>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await runStudio(k, { courseId, lessonId, sourceIds: sources.filter((s) => chosen.has(s.id)).map((s) => s.id), options, replace });
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        {Options ? <Options value={options} onChange={setOptions} /> : null}
        <fieldset className="choices">
          <legend>{t("From these sources", "À partir de ces sources", "Aus diesen Quellen")}</legend>
          {sources.map((s) => (
            <label key={s.id} className="check">
              <input
                type="checkbox"
                checked={chosen.has(s.id)}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.currentTarget.checked) next.add(s.id);
                  else next.delete(s.id);
                  setChosen(next);
                }}
              />
              {s.title}
            </label>
          ))}
        </fieldset>
        {problem ? <Notice kind="error">{problem}</Notice> : null}
        <Notice>
          {t(`The text of the selected sources (${chosen.size}) is sent to ${to}.`, `Le texte des sources choisies (${chosen.size}) est envoyé à ${to}.`, `Der Text der ausgewählten Quellen (${chosen.size}) wird an ${to} gesendet.`)}
          {extra ? ` ${extra}` : ""}
        </Notice>
        {error ? <Notice kind="error">{error}</Notice> : null}
        <div className="row end">
          <button type="button" className="secondary" onClick={onClose}>
            {t("Cancel", "Annuler", "Abbrechen")}
          </button>
          <button type="submit" className="primary" disabled={!chosen.size || Boolean(problem)}>
            <Icon name="sparkle" size={18} /> {replace ? t("Regenerate", "Régénérer", "Neu erstellen") : t("Generate", "Générer", "Erstellen")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
