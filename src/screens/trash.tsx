// The trash: what was deleted in the last 30 days, to restore or delete for
// good. It syncs like everything else, so it is the same on every device.

import { useState } from "react";
import { emptyTrash, listTrash, peek, purge, restore, type TrashEntry } from "../data/db.ts";
import { useLive } from "../data/hooks.ts";
import { type Source, TABLES, type Table } from "../data/schema.ts";
import { count, relative, type T, useLang } from "../i18n.ts";
import { href } from "../router.ts";
import { Icon, type IconName } from "../ui/icons.tsx";
import { Empty } from "../ui/kit.tsx";
import { SOURCE_ICON } from "./sources.tsx";

const ICON: Record<Table, IconName> = { courses: "book", lessons: "layers", sources: "file", chats: "chat", artifacts: "sparkle", concepts: "target", events: "chart" };

function kindOf(table: Table, t: T): string {
  switch (table) {
    case "courses":
      return t("Course", "Cours", "Kurs");
    case "lessons":
      return t("Lesson", "Séance", "Sitzung");
    case "sources":
      return t("Source", "Source", "Quelle");
    case "chats":
      return t("Conversation", "Conversation", "Gespräch");
    case "artifacts":
      return t("Study aid", "Création", "Lernhilfe");
    case "concepts":
      return t("Concept", "Notion", "Begriff");
    case "events":
      return t("Result", "Résultat", "Ergebnis");
  }
}

interface Row extends TrashEntry {
  title: string;
  /** The course and lesson it was in. */
  where: string;
}

async function rows(): Promise<Row[]> {
  const out: Row[] = [];
  for (const e of await listTrash()) {
    const r = e.record as { title?: string; courseId?: string; lessonId?: string };
    const course = r.courseId ? await peek("courses", r.courseId) : undefined;
    const lesson = r.lessonId ? await peek("lessons", r.lessonId) : undefined;
    out.push({ ...e, title: r.title || "—", where: [course?.title, lesson?.title].filter(Boolean).join(" › ") });
  }
  return out;
}

export function TrashScreen() {
  const { t } = useLang();
  const entries = useLive(rows, TABLES, []);
  const [confirm, setConfirm] = useState<string | null>(null);
  if (!entries) return <div className="page" aria-busy="true" />;
  return (
    <div className="page">
      <div className="page-head">
        <h1>{t("Trash", "Corbeille", "Papierkorb")}</h1>
        {entries.length ? (
          confirm === "all" ? (
            <span className="row">
              <button type="button" className="secondary" onClick={() => setConfirm(null)}>
                {t("Cancel", "Annuler", "Abbrechen")}
              </button>
              <button type="button" className="danger" onClick={() => void emptyTrash().then(() => setConfirm(null))}>
                {t("Delete everything for good", "Tout supprimer définitivement", "Alles endgültig löschen")}
              </button>
            </span>
          ) : (
            <button type="button" className="secondary" onClick={() => setConfirm("all")}>
              <Icon name="trash" size={18} /> {t("Empty the trash", "Vider la corbeille", "Papierkorb leeren")}
            </button>
          )
        ) : null}
      </div>
      <p className="lead">{t("What you delete stays here for 30 days, on all your devices, then goes for good.", "Ce que vous supprimez reste ici 30 jours, sur tous vos appareils, puis disparaît pour de bon.", "Was Sie löschen, bleibt hier 30 Tage lang auf allen Ihren Geräten und verschwindet dann endgültig.")}</p>
      {entries.length ? (
        <ul className="list">
          {entries.map((e) => {
            const days = count(Math.max(0, Math.ceil((e.purgeAt - Date.now()) / 86_400_000)), ["day", "days"], ["jour", "jours"], ["Tag", "Tagen"]);
            const items = count(e.items, ["item", "items"], ["élément", "éléments"], ["Element", "Elementen"]);
            const when = relative(e.record.trashedAt!);
            const icon = e.table === "sources" ? SOURCE_ICON[(e.record as Source).kind] : ICON[e.table];
            return (
              <li key={e.record.id} className="list-item trash-item">
                <span className="trash-entry">
                  <Icon name={icon} />
                  <span className="list-main">
                    <span className="list-title">{e.title}</span>
                    <span className="meta">
                      {[
                        kindOf(e.table, t),
                        e.where ? t(`in ${e.where}`, `dans ${e.where}`, `in ${e.where}`) : "",
                        e.items ? t(`with ${items}`, `avec ${items}`, `mit ${items}`) : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className="meta">
                      {t(`Deleted ${when}, gone for good in ${days}`, `Supprimé ${when}, effacé dans ${days}`, `Gelöscht ${when}, endgültig weg in ${days}`)}
                    </span>
                  </span>
                </span>
                <span className="row">
                  {confirm === e.record.id ? (
                    <button type="button" className="danger small" onClick={() => void purge(e.table, e.record.id).then(() => setConfirm(null))}>
                      {t("Delete for good", "Supprimer définitivement", "Endgültig löschen")}
                    </button>
                  ) : (
                    <button type="button" className="icon-button" aria-label={t(`Delete “${e.title}” for good`, `Supprimer « ${e.title} » définitivement`, `„${e.title}“ endgültig löschen`)} onClick={() => setConfirm(e.record.id)}>
                      <Icon name="x" size={18} />
                    </button>
                  )}
                  <button type="button" className="secondary small" aria-label={t(`Restore “${e.title}”`, `Restaurer « ${e.title} »`, `„${e.title}“ wiederherstellen`)} onClick={() => void restore(e.table, e.record.id)}>
                    <Icon name="refresh" size={16} /> {t("Restore", "Restaurer", "Wiederherstellen")}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty icon="trash" title={t("The trash is empty", "La corbeille est vide", "Der Papierkorb ist leer")}>
          <a href={href.courses()}>{t("Back to courses", "Retour aux cours", "Zurück zu den Kursen")}</a>
        </Empty>
      )}
    </div>
  );
}
