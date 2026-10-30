// Discover a new topic (milestone 8): the provider's web search maps the topic and proposes sources.

import { useLang } from "../i18n.ts";
import { Empty } from "../ui/kit.tsx";

export function Discover() {
  const { t } = useLang();
  return (
    <div className="page">
      <h1>{t("Discover a topic", "Découvrir un sujet", "Ein Thema entdecken")}</h1>
      <Empty icon="compass" title={t("Coming in the next version.", "Arrive dans la prochaine version.", "Kommt in der nächsten Version.")} />
    </div>
  );
}
