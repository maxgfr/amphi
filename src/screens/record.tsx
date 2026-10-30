// Record a lecture (milestone 2).

import { useLang } from "../i18n.ts";
import { Empty } from "../ui/kit.tsx";

export function RecordScreen({ courseId }: { courseId: string; lessonId?: string }) {
  const { t } = useLang();
  return (
    <div className="page" data-course={courseId}>
      <h1>{t("Record a lecture", "Enregistrer un cours", "Vorlesung aufnehmen")}</h1>
      <Empty icon="mic" title={t("Coming in the next version.", "Arrive dans la prochaine version.", "Kommt in der nächsten Version.")} />
    </div>
  );
}
