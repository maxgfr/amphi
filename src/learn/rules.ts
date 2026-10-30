// Progress's step for Today: the concepts to review (src/learn/progress.ts).

import { list } from "../data/db.ts";
import { addStepRule } from "./next.ts";
import { reviewSteps } from "./progress.ts";

addStepRule(async (now) => {
  const [courses, concepts, events] = await Promise.all([list("courses"), list("concepts"), list("events")]);
  return reviewSteps(courses, concepts, events, now);
});
