// Create or edit a course (or a topic): title, emoji, language of the
// material, exam date.

import { useState } from "react";
import { fresh, put } from "../data/db.ts";
import type { Course } from "../data/schema.ts";
import { LANGS, languageLabel, useLang } from "../i18n.ts";
import { Field, Sheet } from "../ui/kit.tsx";

export const MATERIAL_LANGS = [...LANGS, "es", "it", "pt", "nl"];

export function CourseForm({ open, onClose, course, kind = "course", onSaved }: { open: boolean; onClose: () => void; course?: Course; kind?: Course["kind"]; onSaved?: (c: Course) => void }) {
  const { t, lang } = useLang();
  const [title, setTitle] = useState(course?.title ?? "");
  const [emoji, setEmoji] = useState(course?.emoji ?? "");
  const [language, setLanguage] = useState(course?.language ?? lang);
  const [examDate, setExamDate] = useState(course?.examDate ?? "");
  const isTopic = (course?.kind ?? kind) === "topic";
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={course ? t("Edit", "Modifier", "Bearbeiten") : isTopic ? t("New topic", "Nouveau sujet", "Neues Thema") : t("New course", "Nouveau cours", "Neuer Kurs")}
    >
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const base: Course = course ?? { ...fresh(), kind, title: "" };
          const saved = await put("courses", { ...base, title: title.trim(), emoji: emoji.trim() || undefined, language, examDate: examDate || undefined });
          onSaved?.(saved);
          onClose();
        }}
      >
        <div className="row">
          <Field label={t("Emoji", "Emoji", "Emoji")}>
            <input className="emoji-input" value={emoji} maxLength={4} onChange={(e) => setEmoji(e.currentTarget.value)} placeholder="📘" />
          </Field>
          <Field label={t("Title", "Titre", "Titel")}>
            <input value={title} onChange={(e) => setTitle(e.currentTarget.value)} required data-autofocus placeholder={isTopic ? t("Thermodynamics", "Thermodynamique", "Thermodynamik") : t("Organic chemistry", "Chimie organique", "Organische Chemie")} />
          </Field>
        </div>
        <Field label={t("Language of the material", "Langue des supports", "Sprache der Unterlagen")} hint={t("Summaries, quizzes and podcasts are written in it.", "Les résumés, quiz et podcasts sont écrits dans cette langue.", "Zusammenfassungen, Quizze und Podcasts werden in dieser Sprache geschrieben.")}>
          <select value={language} onChange={(e) => setLanguage(e.currentTarget.value)}>
            {MATERIAL_LANGS.map((l) => (
              <option key={l} value={l}>
                {languageLabel(l)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Exam date (optional)", "Date d'examen (facultatif)", "Prüfungsdatum (optional)")}>
          <input type="date" value={examDate} onChange={(e) => setExamDate(e.currentTarget.value)} />
        </Field>
        <div className="row end">
          <button type="button" className="secondary" onClick={onClose}>
            {t("Cancel", "Annuler", "Abbrechen")}
          </button>
          <button type="submit" className="primary" disabled={!title.trim()}>
            {course ? t("Save", "Enregistrer", "Speichern") : t("Create", "Créer", "Erstellen")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
