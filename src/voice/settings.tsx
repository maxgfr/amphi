// Voices for audio summaries, podcasts and video narration (milestone 6).

import { useLang } from "../i18n.ts";
import { Empty } from "../ui/kit.tsx";

export function VoiceSettings() {
  const { t } = useLang();
  return <Empty icon="headphones" title={t("Coming in the next version.", "Arrive dans la prochaine version.", "Kommt in der nächsten Version.")} />;
}
