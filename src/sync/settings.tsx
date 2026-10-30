// Sync to a GitHub repository, a local folder or a zip (milestone 9).

import { useLang } from "../i18n.ts";
import { Empty } from "../ui/kit.tsx";

export function SyncSettings() {
  const { t } = useLang();
  return <Empty icon="cloud" title={t("Coming in the next version.", "Arrive dans la prochaine version.", "Kommt in der nächsten Version.")} />;
}
