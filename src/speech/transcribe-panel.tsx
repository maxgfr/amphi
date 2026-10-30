// Transcription of an audio or video source (milestone 2).

import type { Source } from "../data/schema.ts";
import { useLang } from "../i18n.ts";
import { Notice } from "../ui/kit.tsx";

export function TranscribePanel({ source }: { source: Source }) {
  const { t } = useLang();
  return <Notice key={source.id}>{t("Transcription is coming in the next version.", "La transcription arrive dans la prochaine version.", "Die Transkription kommt in der nächsten Version.")}</Notice>;
}
