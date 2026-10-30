import { useKeyVault } from "llm-connect/react";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { LANGS, setLang, useLang } from "./i18n.ts";
import { applyUpdate, dismissUpdate, useWaitingUpdate } from "./pwa.ts";
import { type Route, href, useRoute } from "./router.ts";
import { Courses } from "./screens/courses.tsx";
import { CourseScreen } from "./screens/course.tsx";
import { LessonScreen } from "./screens/lesson.tsx";
import { SourceScreen } from "./screens/source.tsx";
import { Today } from "./screens/today.tsx";
import { Unlock } from "./screens/unlock.tsx";
import { loadVault, vault } from "./secrets.ts";
import { SyncBadge } from "./sync/badge.tsx";
import { Icon, type IconName } from "./ui/icons.tsx";

// Screens that pull in the AI SDK, recorders or exporters load when opened.
const ArtifactScreen = lazy(() => import("./screens/artifact.tsx").then((m) => ({ default: m.ArtifactScreen })));
const Settings = lazy(() => import("./screens/settings.tsx").then((m) => ({ default: m.Settings })));
const Discover = lazy(() => import("./screens/discover.tsx").then((m) => ({ default: m.Discover })));
const Record = lazy(() => import("./screens/record.tsx").then((m) => ({ default: m.RecordScreen })));

type Theme = "system" | "light" | "dark";
const THEME_KEY = "amphi-theme";

function useTheme(): [boolean, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) as Theme | null) ?? "system");
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  const dark = theme === "dark" || (theme === "system" && systemDark);
  return [dark, () => setTheme(dark ? "light" : "dark")];
}

const section = (r: Route): string => {
  if (r.page === "course" || r.page === "lesson" || r.page === "source" || r.page === "artifact" || r.page === "record") return "courses";
  return r.page;
};

function Screen({ route }: { route: Route }): ReactNode {
  switch (route.page) {
    case "today":
      return <Today />;
    case "courses":
      return <Courses />;
    case "discover":
      return <Discover />;
    case "course":
      return <CourseScreen key={route.id} id={route.id} tab={route.tab} />;
    case "lesson":
      return <LessonScreen key={route.id} id={route.id} tab={route.tab} />;
    case "source":
      return <SourceScreen key={route.id} id={route.id} at={route.at} />;
    case "artifact":
      return <ArtifactScreen key={route.id} id={route.id} />;
    case "record":
      return <Record courseId={route.courseId} lessonId={route.lessonId} />;
    case "settings":
      return <Settings section={route.section} />;
  }
}

export function App() {
  const route = useRoute();
  const { lang, t } = useLang();
  const [dark, toggleTheme] = useTheme();
  const { state: vaultState } = useKeyVault(vault);
  useEffect(() => {
    void loadVault();
  }, []);
  useEffect(() => {
    document.getElementById("main")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [route.page, (route as { id?: string }).id]);

  const nav: { id: string; href: string; icon: IconName; label: string }[] = [
    { id: "today", href: href.today(), icon: "home", label: t("Today", "Aujourd'hui", "Heute") },
    { id: "courses", href: href.courses(), icon: "book", label: t("Courses", "Cours", "Kurse") },
    { id: "discover", href: href.discover(), icon: "compass", label: t("Discover", "Découvrir", "Entdecken") },
    { id: "settings", href: href.settings(), icon: "settings", label: t("Settings", "Réglages", "Einstellungen") },
  ];
  const current = section(route);

  return (
    <div className="shell">
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById("main")?.focus())}>
        {t("Skip to content", "Aller au contenu", "Zum Inhalt springen")}
      </a>
      <header className="rail">
        <a className="wordmark" href={href.today()}>
          amphi
        </a>
        <nav aria-label={t("Main", "Principale", "Hauptnavigation")}>
          {nav.map((n) => (
            <a key={n.id} href={n.href} aria-current={current === n.id ? "page" : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </a>
          ))}
        </nav>
        <div className="rail-tools">
          <div className="segmented small" role="group" aria-label={t("Language", "Langue", "Sprache")}>
            {LANGS.map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <SyncBadge />
          <button type="button" className="icon-button" onClick={toggleTheme} aria-label={dark ? t("Light theme", "Thème clair", "Helles Design") : t("Dark theme", "Thème sombre", "Dunkles Design")}>
            <Icon name={dark ? "sun" : "moon"} />
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {vaultState === "locked" ? (
          <Unlock />
        ) : (
          <Suspense fallback={<div className="page" aria-busy="true" />}>
            <Screen route={route} />
          </Suspense>
        )}
      </main>
      <UpdateToast />
    </div>
  );
}

/** A new version is installed and waiting: it takes over when the student reloads, never under them. */
function UpdateToast() {
  const { t } = useLang();
  const waiting = useWaitingUpdate();
  return (
    <div className="toast-region" aria-live="polite">
      {waiting ? (
        <div className="toast">
          <span>{t("A new version of amphi is ready.", "Une nouvelle version d'amphi est prête.", "Eine neue Version von amphi ist bereit.")}</span>
          <span className="toast-actions">
            <button type="button" className="link" onClick={dismissUpdate}>
              {t("Later", "Plus tard", "Später")}
            </button>
            <button type="button" className="primary small" onClick={applyUpdate}>
              {t("Reload", "Recharger", "Neu laden")}
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
