// English, French and German, following the browser until the user picks one.
// Strings live next to the code that shows them, as t("English", "Français",
// "Deutsch") triples, so a translation never drifts from its context and two
// features never edit the same catalog.

import { useSyncExternalStore } from "react";

export const LANGS = ["en", "fr", "de"] as const;
export type Lang = (typeof LANGS)[number];

const KEY = "amphi-lang";
const listeners = new Set<() => void>();

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if ((LANGS as readonly string[]).includes(saved ?? "")) return saved as Lang;
  } catch {}
  const nav = navigator.language?.toLowerCase() ?? "";
  return nav.startsWith("fr") ? "fr" : nav.startsWith("de") ? "de" : "en";
}

let lang: Lang = typeof navigator === "undefined" ? "en" : initial();
if (typeof document !== "undefined") document.documentElement.lang = lang;

export function setLang(next: Lang) {
  lang = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  for (const fn of listeners) fn();
}

export const currentLang = () => lang;

const pick = (l: Lang, en: string, fr: string, de: string) => (l === "fr" ? fr : l === "de" ? de : en);

export type T = (en: string, fr: string, de: string) => string;

export function useLang(): { lang: Lang; t: T } {
  const l = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => lang,
    () => lang,
  );
  return { lang: l, t: (en, fr, de) => pick(l, en, fr, de) };
}

/** For code outside components (errors, titles, prompts' fallbacks). */
export const tr: T = (en, fr, de) => pick(lang, en, fr, de);

/** Strings in a course's language rather than the interface's (titles of what is generated); English for others. */
export const trIn =
  (code: string | undefined): T =>
  (en, fr, de) =>
    pick(code?.startsWith("fr") ? "fr" : code?.startsWith("de") ? "de" : "en", en, fr, de);

/** "Score:" in English and German, "Score :" in French. */
export const colon = (label: string, l: string = lang) => (l.startsWith("fr") ? `${label} :` : `${label}:`);

/** "1 lesson", "3 lessons", in the interface's language: each pair is [one, other]. */
export function count(n: number, en: [string, string], fr: [string, string], de: [string, string], l: Lang = lang): string {
  const forms = l === "fr" ? fr : l === "de" ? de : en;
  return `${new Intl.NumberFormat(l).format(n)} ${new Intl.PluralRules(l).select(n) === "one" ? forms[0] : forms[1]}`;
}

const units: Record<Lang, string[]> = { en: ["B", "KB", "MB", "GB"], fr: ["o", "Ko", "Mo", "Go"], de: ["B", "KB", "MB", "GB"] };

export function bytes(n: number, l: Lang = lang): string {
  let i = 0;
  let v = n;
  while (v >= 1000 && i < 3) {
    v /= 1000;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat(l, { maximumFractionDigits: digits }).format(v)} ${units[l][i]}`;
}

/** A language code as a name in the interface's language: "fr" → "French" / "français" / "Französisch". */
export function languageLabel(code: string, l: Lang = lang): string {
  try {
    return new Intl.DisplayNames([l], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A language code as an English name, for prompts: "fr" → "French". */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export const dateTime = (ms: number, l: Lang = lang) => new Intl.DateTimeFormat(l, { dateStyle: "medium", timeStyle: "short" }).format(ms);
export const dateOnly = (ms: number, l: Lang = lang) => new Intl.DateTimeFormat(l, { dateStyle: "medium" }).format(ms);

/** "3 days ago", "in 2 hours". */
export function relative(ms: number, now = Date.now(), l: Lang = lang): string {
  const rtf = new Intl.RelativeTimeFormat(l, { numeric: "auto" });
  const s = Math.round((ms - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

/** m:ss or h:mm:ss. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
