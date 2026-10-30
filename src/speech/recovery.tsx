// An interrupted recording (the tab closed or crashed while recording):
// offered back, from the chunks that reached the disk, on the record screen
// and on its course's sources.

import { useEffect, useState } from "react";
import { useLive } from "../data/hooks.ts";
import type { Id } from "../data/schema.ts";
import { clock, dateTime, useLang } from "../i18n.ts";
import { go, href } from "../router.ts";
import { Icon } from "../ui/icons.tsx";
import { Notice } from "../ui/kit.tsx";
import { type Draft, discardDraft, loadDraft, recoverDraft, recordingElsewhere, recoveryState } from "./draft.ts";
import { recorderState } from "./recorder.ts";

/** The draft and what to do with it; an empty one is dropped. */
export function useRecovery(): { found: { draft: Draft; state: "busy" | "interrupted" } | null; refresh: () => void } {
  const [tick, setTick] = useState(0);
  const found = useLive(
    async () => {
      if (recorderState() !== "idle") return null;
      const d = await loadDraft();
      const state = recoveryState(d, await recordingElsewhere());
      if (state === "empty" && d) await discardDraft(d);
      return d && (state === "busy" || state === "interrupted") ? { draft: d, state } : null;
    },
    ["sources"],
    [tick],
  );
  // Another tab's recording may end at any moment: look again now and then while it runs.
  useEffect(() => {
    if (found?.state !== "busy") return;
    const id = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, [found?.state]);
  return { found: found ?? null, refresh: () => setTick((n) => n + 1) };
}

export function RecoveryNotice({ courseId }: { courseId?: Id }) {
  const { t } = useLang();
  const { found, refresh } = useRecovery();
  const [busy, setBusy] = useState(false);
  if (!found || (courseId && found.draft.courseId !== courseId)) return null;
  const { draft, state } = found;
  if (state === "busy")
    return courseId ? null : <Notice>{t("A recording is running in another tab or window.", "Un enregistrement est en cours dans un autre onglet ou une autre fenêtre.", "In einem anderen Tab oder Fenster läuft eine Aufnahme.")}</Notice>;
  const when = dateTime(draft.startedAt);
  return (
    <Notice>
      <div className="stack">
        <p>
          {t(
            `A recording started ${when} was interrupted (about ${clock(draft.elapsed)} saved). Keep what was saved?`,
            `Un enregistrement commencé le ${when} a été interrompu (environ ${clock(draft.elapsed)} sauvegardées). Garder ce qui a été sauvegardé ?`,
            `Eine am ${when} begonnene Aufnahme wurde unterbrochen (etwa ${clock(draft.elapsed)} gesichert). Das Gesicherte behalten?`,
          )}
        </p>
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const source = await recoverDraft(draft);
              go(href.source(source.id));
            }}
          >
            <Icon name="check" size={18} /> {t("Recover the recording", "Récupérer l'enregistrement", "Aufnahme wiederherstellen")}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await discardDraft(draft);
              setBusy(false);
              refresh();
            }}
          >
            <Icon name="trash" size={18} /> {t("Discard", "Jeter", "Verwerfen")}
          </button>
        </div>
      </div>
    </Notice>
  );
}
