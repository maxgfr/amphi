// Progress of a course (milestone 8): concepts, mastery, the tutor.

import type { Id } from "../data/schema.ts";
import { useLang } from "../i18n.ts";
import { Empty } from "../ui/kit.tsx";

export function ProgressPanel({ courseId }: { courseId: Id }) {
  const { t } = useLang();
  return <Empty key={courseId} icon="target" title={t("Coming in the next version.", "Arrive dans la prochaine version.", "Kommt in der nächsten Version.")} />;
}
