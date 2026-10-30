// The shell's sync icon: shown once a repository is connected, it says how
// sync stands and leads to its settings.

import { useEffect } from "react";
import { count, relative, useLang } from "../i18n.ts";
import { href } from "../router.ts";
import { Icon } from "../ui/icons.tsx";
import { startAutoSync, useSyncStatus } from "./run.ts";

export function SyncBadge() {
  const s = useSyncStatus();
  const { t, lang } = useLang();
  useEffect(() => {
    startAutoSync();
  }, []);
  if (!s.config) return null;
  const state = s.running ? "busy" : s.error ? "error" : s.pending > 0 ? "waiting" : "ok";
  const label =
    state === "busy"
      ? t("Syncing…", "Synchronisation…", "Synchronisierung…")
      : state === "error"
        ? t("Sync failed", "La synchro a échoué", "Synchronisierung fehlgeschlagen")
        : state === "waiting"
          ? count(s.pending, ["change waiting to sync", "changes waiting to sync"], ["modification à synchroniser", "modifications à synchroniser"], ["Änderung wartet auf Sync", "Änderungen warten auf Sync"], lang)
          : s.at
            ? t(`Synced ${relative(s.at, Date.now(), lang)}`, `Synchronisé ${relative(s.at, Date.now(), lang)}`, `Synchronisiert ${relative(s.at, Date.now(), lang)}`)
            : t("Sync", "Synchro", "Sync");
  return (
    <a className="button icon-button sync-badge" data-state={state} href={href.settings("sync")} aria-label={label} title={label}>
      <Icon name="cloud" />
    </a>
  );
}
