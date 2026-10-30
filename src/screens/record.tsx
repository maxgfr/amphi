// Record a lecture: a big button, the time, the input level, pause, and a
// button to mark the important moments. Every ten seconds reach the disk as
// they are recorded; stopping keeps the recording as a source of the chosen
// lesson (or of a new one, dated today) and opens it to be transcribed.

import { useEffect, useRef, useState } from "react";
import { get, list } from "../data/db.ts";
import { useLive } from "../data/hooks.ts";
import type { Id } from "../data/schema.ts";
import { clock, dateOnly, useLang } from "../i18n.ts";
import { go, href } from "../router.ts";
import { isoDay } from "../speech/draft.ts";
import { elapsed, level, markMoment, pauseRecording, resumeRecording, startRecording, stopRecording, useRecorder } from "../speech/recorder.ts";
import { RecoveryNotice, useRecovery } from "../speech/recovery.tsx";
import { Icon } from "../ui/icons.tsx";
import { Empty, Field, Notice } from "../ui/kit.tsx";

const NEW = "new";

export function RecordScreen({ courseId, lessonId }: { courseId: string; lessonId?: string }) {
  const { t } = useLang();
  const rec = useRecorder();
  const { found } = useRecovery();
  // A recording running in this tab belongs to its own course, whatever the address says.
  const activeCourse = rec.state !== "idle" && rec.courseId ? rec.courseId : courseId;
  const data = useLive(
    async () => {
      const course = await get("courses", activeCourse);
      if (!course) return null;
      const lessons = (await list("lessons", "courseId", course.id)).sort((a, b) => a.order - b.order);
      return { course, lessons };
    },
    ["courses", "lessons"],
    [activeCourse],
  );
  const [picked, setPicked] = useState<Id | null>(null);
  useClock(rec.state === "recording");
  const stopping = useRef(false);

  if (data === undefined) return <div className="page" aria-busy="true" />;
  if (data === null)
    return (
      <div className="page">
        <Empty icon="mic" title={t("This course no longer exists.", "Ce cours n'existe plus.", "Dieser Kurs existiert nicht mehr.")} />
      </div>
    );
  const { course, lessons } = data;
  const isCourse = course.kind === "course";
  const fallback = lessons.find((l) => l.id === lessonId)?.id ?? lessons.find((l) => l.date === isoDay(Date.now()))?.id ?? NEW;
  const choice = picked ?? fallback;
  const recordingLesson = rec.state !== "idle" ? lessons.find((l) => l.id === rec.lessonId) : lessons.find((l) => l.id === choice);
  const live = rec.state === "recording" || rec.state === "paused";
  const busyElsewhere = rec.state === "idle" && found?.state === "busy";

  const start = () =>
    void startRecording({
      courseId: course.id,
      lessonId: isCourse && choice !== NEW ? choice : undefined,
      newLesson: isCourse && choice === NEW,
    });
  const stop = async () => {
    if (stopping.current) return;
    stopping.current = true;
    const source = await stopRecording();
    stopping.current = false;
    if (source) go(href.source(source.id));
  };

  const status =
    rec.state === "starting"
      ? t("Opening the microphone…", "Ouverture du micro…", "Mikrofon wird geöffnet…")
      : rec.state === "recording"
        ? t("Recording", "Enregistrement en cours", "Aufnahme läuft")
        : rec.state === "paused"
          ? t("Paused", "En pause", "Pausiert")
          : rec.state === "stopping"
            ? t("Saving the recording…", "Enregistrement du fichier…", "Aufnahme wird gespeichert…")
            : t("Ready to record", "Prêt à enregistrer", "Bereit zur Aufnahme");

  return (
    <div className="page narrow">
      <nav className="crumbs" aria-label={t("Breadcrumb", "Fil d'Ariane", "Brotkrumen")}>
        <a href={href.course(course.id)}>{course.title}</a>
        {recordingLesson && (rec.state !== "idle" || lessonId) ? <a href={href.lesson(recordingLesson.id)}>{recordingLesson.title}</a> : null}
      </nav>
      <h1>{t("Record a lecture", "Enregistrer un cours", "Vorlesung aufnehmen")}</h1>
      {rec.state === "idle" ? <RecoveryNotice /> : null}
      {rec.error ? <Notice kind="error">{rec.error}</Notice> : null}
      {rec.state === "idle" && rec.saved ? (
        <Notice kind="ok">
          {t("The recording stopped and was saved.", "L'enregistrement s'est arrêté et a été sauvegardé.", "Die Aufnahme wurde beendet und gespeichert.")} <a href={href.source(rec.saved)}>{t("Open it", "L'ouvrir", "Öffnen")}</a>
        </Notice>
      ) : null}

      {isCourse && rec.state === "idle" ? (
        <Field label={t("Lesson", "Séance", "Sitzung")}>
          <select value={choice} onChange={(e) => setPicked(e.currentTarget.value)}>
            <option value={NEW}>{t(`A new lesson, dated today (${dateOnly(Date.now())})`, `Une nouvelle séance, datée d'aujourd'hui (${dateOnly(Date.now())})`, `Eine neue Sitzung mit heutigem Datum (${dateOnly(Date.now())})`)}</option>
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
                {l.date ? ` · ${dateOnly(new Date(l.date).getTime())}` : ""}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <section className={`recorder ${rec.state}`} aria-label={t("Recorder", "Enregistreur", "Rekorder")}>
        <p className="rec-status" role="status">
          {status}
        </p>
        <p className="rec-time" role="timer" aria-label={t("Recorded time", "Durée enregistrée", "Aufgenommene Zeit")}>
          {clock(live || rec.state === "stopping" ? elapsed() : 0)}
        </p>
        <LevelMeter active={live} />
        {live || rec.state === "stopping" ? (
          <div className="rec-controls">
            {rec.state === "paused" ? (
              <button type="button" className="secondary rec-side" onClick={resumeRecording}>
                <Icon name="play" /> {t("Resume", "Reprendre", "Fortsetzen")}
              </button>
            ) : (
              <button type="button" className="secondary rec-side" onClick={pauseRecording} disabled={rec.state !== "recording"}>
                <Icon name="pause" /> {t("Pause", "Pause", "Pause")}
              </button>
            )}
            <button type="button" className="rec-button stop" onClick={() => void stop()} disabled={rec.state === "stopping"} aria-label={t("Stop and save", "Arrêter et sauvegarder", "Beenden und speichern")}>
              <Icon name="stop" size={32} />
            </button>
            <button type="button" className="secondary rec-side" onClick={markMoment} disabled={rec.state === "stopping"}>
              <Icon name="flag" /> {t("Important", "Important", "Wichtig")}
            </button>
          </div>
        ) : (
          <div className="rec-controls">
            <button type="button" className="rec-button" onClick={start} disabled={rec.state === "starting" || busyElsewhere} aria-label={t("Start recording", "Commencer l'enregistrement", "Aufnahme starten")}>
              <Icon name="mic" size={32} />
            </button>
          </div>
        )}
        {rec.markers.length ? (
          <ol className="row wrap rec-markers" aria-label={t("Marked moments", "Moments marqués", "Markierte Stellen")}>
            {rec.markers.map((m) => (
              <li key={m.t} className="chip">
                <Icon name="flag" size={16} /> {clock(m.t)}
              </li>
            ))}
          </ol>
        ) : null}
      </section>
      <p className="meta">
        {live
          ? t(
              "Each ten seconds is saved on this device as you go: if the tab closes, the recording can be recovered. The screen stays on while recording.",
              "Chaque tranche de dix secondes est sauvegardée sur cet appareil au fil de l'eau : si l'onglet se ferme, l'enregistrement peut être récupéré. L'écran reste allumé pendant l'enregistrement.",
              "Alle zehn Sekunden wird auf diesem Gerät gesichert: Schließt sich der Tab, lässt sich die Aufnahme wiederherstellen. Der Bildschirm bleibt während der Aufnahme an.",
            )
          : t(
              "The recording stays on this device. Once stopped, you choose how to transcribe it: on this device, or with your AI provider.",
              "L'enregistrement reste sur cet appareil. Une fois arrêté, vous choisissez comment le transcrire : sur cet appareil, ou avec votre fournisseur d'IA.",
              "Die Aufnahme bleibt auf diesem Gerät. Danach wählen Sie, wie sie transkribiert wird: auf diesem Gerät oder mit Ihrem KI-Anbieter.",
            )}
      </p>
    </div>
  );
}

/** Re-renders every quarter second while `on`, for the time shown. */
function useClock(on: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setN((x) => x + 1), 250);
    return () => clearInterval(id);
  }, [on]);
}

/** The input level, drawn each frame without re-rendering React. */
function LevelMeter({ active }: { active: boolean }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) {
      bar.current?.style.setProperty("--level", "0");
      return;
    }
    let raf = 0;
    const frame = () => {
      bar.current?.style.setProperty("--level", level().toFixed(3));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return (
    <div className="rec-level" aria-hidden="true">
      <div ref={bar} className="rec-level-bar" />
    </div>
  );
}
