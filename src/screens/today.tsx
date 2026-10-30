// Today: the one thing to do now, a few more, and the courses.

import { useLive } from "../data/hooks.ts";
import { type T, useLang } from "../i18n.ts";
import { nextSteps, type Step } from "../learn/next.ts";
// Registers the concepts to review among the next steps.
import "../learn/rules.ts";
import { href } from "../router.ts";
import { Icon, type IconName } from "../ui/icons.tsx";
import { courseHue } from "../ui/hue.ts";
import { Binder, courseSummaries } from "./courses.tsx";

async function configured(): Promise<boolean> {
  const { loadLlm, savedSettings } = await import("../ai/llm.ts");
  await loadLlm();
  return Boolean(savedSettings());
}

function describe(s: Step, t: T): { icon: IconName; text: string; action: string; to: string } {
  switch (s.kind) {
    case "create-course":
      return { icon: "book", text: t("Start with a course: its lectures, slides and notes go in it.", "Commencez par un cours : ses séances, diapos et notes y vont.", "Beginnen Sie mit einem Kurs: Vorlesungen, Folien und Notizen kommen hinein."), action: t("Create a course", "Créer un cours", "Kurs erstellen"), to: href.courses() };
    case "setup-ai":
      return { icon: "sparkle", text: t("Connect your AI provider to get summaries, quizzes, podcasts and more.", "Connectez votre fournisseur d'IA pour obtenir résumés, quiz, podcasts et plus.", "Verbinden Sie Ihren KI-Anbieter für Zusammenfassungen, Quizze, Podcasts und mehr."), action: t("Set up AI", "Configurer l'IA", "KI einrichten"), to: href.settings("ai") };
    case "transcribe":
      return { icon: "mic", text: t(`“${s.title}” is waiting to be transcribed.`, `« ${s.title} » attend d'être transcrit.`, `„${s.title}“ wartet auf die Transkription.`), action: t("Transcribe", "Transcrire", "Transkribieren"), to: href.source(s.sourceId!) };
    case "exam-soon":
      return {
        icon: "flag",
        text: s.days === 0 ? t(`${s.title}: the exam is today.`, `${s.title} : l'examen est aujourd'hui.`, `${s.title}: Die Prüfung ist heute.`) : t(`${s.title}: exam in ${s.days} days. A study guide and a quiz help.`, `${s.title} : examen dans ${s.days} jours. Un guide de révision et un quiz aident.`, `${s.title}: Prüfung in ${s.days} Tagen. Ein Lernleitfaden und ein Quiz helfen.`),
        action: t("Open the Studio", "Ouvrir le Studio", "Studio öffnen"),
        to: href.course(s.courseId!, "studio"),
      };
    case "summarize-lesson":
      return { icon: "report", text: t(`“${s.title}” has sources but nothing made from them yet.`, `« ${s.title} » a des sources mais rien n'en a encore été tiré.`, `„${s.title}“ hat Quellen, aber noch nichts daraus erstellt.`), action: t("Make a summary", "Faire un résumé", "Zusammenfassung erstellen"), to: href.lesson(s.lessonId!, "studio") };
    case "review-concept":
      return { icon: "target", text: t(`Review “${s.title}”: it is still shaky.`, `Revoyez « ${s.title} » : c'est encore fragile.`, `Wiederholen Sie „${s.title}“: Es sitzt noch nicht.`), action: t("Review", "Revoir", "Wiederholen"), to: href.course(s.courseId!, "progress") };
  }
}

export function Today() {
  const { lang, t } = useLang();
  const data = useLive(
    async () => {
      const [steps, courses] = await Promise.all([configured().then((c) => nextSteps(c)), courseSummaries()]);
      return { steps, courses };
    },
    ["courses", "lessons", "sources", "artifacts", "events", "concepts"],
    [],
  );
  if (!data) return <div className="page" aria-busy="true" />;
  const [first, ...rest] = data.steps;
  const courseOf = (s: Step) => data.courses.find((c) => c.course.id === s.courseId)?.course;
  const today = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  return (
    <div className="page">
      <div className="today-head">
        <h1>{t("Today", "Aujourd'hui", "Heute")}</h1>
        <p className="today-date">{today}</p>
      </div>
      {first ? (
        (() => {
          const d = describe(first, t);
          const course = courseOf(first);
          return (
            <section className="next" data-hue={course ? courseHue(course) : undefined} aria-label={t("Next step", "Prochaine étape", "Nächster Schritt")}>
              <Icon name={d.icon} size={24} />
              <p className="next-text">{d.text}</p>
              <a className="button primary" href={d.to}>
                {d.action}
              </a>
            </section>
          );
        })()
      ) : (
        <section className="next calm">
          <Icon name="check" size={24} />
          <p className="next-text">{t("Nothing urgent. Record or import today's lecture when it is done.", "Rien d'urgent. Enregistrez ou importez le cours du jour quand il est terminé.", "Nichts Dringendes. Nehmen Sie die heutige Vorlesung auf oder importieren Sie sie, wenn sie vorbei ist.")}</p>
        </section>
      )}
      {rest.length ? (
        <ul className="list compact">
          {rest.slice(0, 4).map((s) => {
            const d = describe(s, t);
            const course = courseOf(s);
            return (
              <li key={`${s.kind}-${s.sourceId ?? s.lessonId ?? s.courseId ?? s.conceptId}`} className="list-item" data-hue={course ? courseHue(course) : undefined}>
                <a className="list-link" href={d.to}>
                  {course ? <span className="step-tab" aria-hidden="true" /> : <Icon name={d.icon} />}
                  <span className="list-main">{d.text}</span>
                  <span className="list-end">{d.action}</span>
                  <Icon name="chevron-right" />
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
      {data.courses.length ? (
        <>
          <h2 className="section-title">{t("Your courses", "Vos cours", "Ihre Kurse")}</h2>
          <Binder rows={data.courses.slice(0, 8)} />
        </>
      ) : null}
    </div>
  );
}
