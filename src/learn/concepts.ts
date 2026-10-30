// Concepts as the model gives them (a topic's plan, or a course read from its
// sources), made into records in learning order with their prerequisites
// linked, and drawn as a mind map where each concept hangs under what it
// builds on.

import { z } from "zod";
import { budgetFor, buildContext } from "../ai/context.ts";
import { capabilities, writeIn } from "../ai/llm.ts";
import { askJson } from "../ai/structured.ts";
import { fresh, put } from "../data/db.ts";
import type { Concept, Course, Id, Source } from "../data/schema.ts";
import { currentLang } from "../i18n.ts";
import { citeLabel, MAX_DEPTH, type MindNode, newNodeId } from "../studio/render/mindmap-tree.ts";
import { nameSimilarity, nameTokens } from "./progress.ts";

export const RawConcept = z.object({
  title: z.string().trim().min(1),
  summary: z.string().nullish(),
  prerequisites: z.array(z.coerce.string()).nullish(),
  refs: z.array(z.coerce.string()).nullish(),
});
export type RawConcept = z.infer<typeof RawConcept>;

/** The model's answer: { concepts: [...] } or a bare array. */
export const ConceptsAnswer = z
  .union([z.object({ concepts: z.array(RawConcept) }).transform((o) => o.concepts), z.array(RawConcept)])
  .refine((cs) => cs.length > 0, { message: "no concept" });

export const CONCEPTS_SHAPE = `{ "concepts": [ {
  "title": string,            // 1 to 6 words
  "summary": string,          // one paragraph: what it is and why it matters, with citation labels
  "prerequisites": string[],  // titles of earlier concepts of this list it builds on
  "refs": string[]            // the labels of the passages it comes from, e.g. "S1 p.3"
} ] }`;

/** Concept records in the given order, the same concept once, prerequisites linked by title to the concepts before. */
export function conceptRecords(raw: readonly RawConcept[], courseId: Id, now = Date.now()): Concept[] {
  const out: Concept[] = [];
  for (const r of raw) {
    const title = r.title.replace(/\s+/g, " ");
    if (out.some((c) => nameTokens(c.title).join(" ") === nameTokens(title).join(" "))) continue;
    const prerequisites: Id[] = [];
    for (const p of r.prerequisites ?? []) {
      let best: Concept | undefined;
      let score = 0;
      for (const c of out) {
        const s = nameSimilarity(p, c.title);
        if (s > score) [best, score] = [c, s];
      }
      if (best && !prerequisites.includes(best.id)) prerequisites.push(best.id);
    }
    const refs = [...new Set((r.refs ?? []).map((x) => citeLabel(x)).filter((x) => x !== undefined))];
    out.push({ ...fresh(now), courseId, title, summary: r.summary?.trim() ?? "", order: out.length + 1, prerequisites, refs });
  }
  return out;
}

const firstSentence = (s: string) => {
  const one = /^[\s\S]*?[.!?](?=\s|$)/.exec(s.trim())?.[0] ?? s.trim();
  return one.length > 160 ? `${one.slice(0, 157)}…` : one;
};

/** The topic as a tree: each concept under its last prerequisite already placed (the root when none), at most MAX_DEPTH levels. */
export function conceptTree(title: string, concepts: readonly Concept[]): MindNode {
  const root: MindNode = { id: newNodeId(), title, children: [] };
  const placed = new Map<Id, { node: MindNode; depth: number; parent?: Id }>();
  for (const c of [...concepts].sort((a, b) => a.order - b.order)) {
    let parentId = [...c.prerequisites].reverse().find((id) => placed.has(id));
    while (parentId && placed.get(parentId)!.depth >= MAX_DEPTH) parentId = placed.get(parentId)!.parent;
    const parent = parentId ? placed.get(parentId)! : { node: root, depth: 1 };
    const summary = c.summary.trim();
    const node: MindNode = { id: newNodeId(), title: c.title, note: summary ? firstSentence(summary) : undefined, cite: c.refs[0], children: [] };
    parent.node.children.push(node);
    placed.set(c.id, { node, depth: parent.depth + 1, parent: parentId });
  }
  return root;
}

/** Read a course's sources for the concepts to master, and keep them. */
export async function generateConcepts(course: Course, sources: Source[], signal?: AbortSignal): Promise<Concept[]> {
  const context = buildContext(sources, { budget: budgetFor(capabilities().contextWindow) });
  const raw = await askJson(ConceptsAnswer, {
    system: `You list the concepts a student must master in their course sources, in the order to learn them: what comes first is needed by what follows. Give 4 to 15 concepts. Each has a short title, a one-paragraph summary that cites the passages with their labels in square brackets (e.g. [S1 p.3]), its prerequisites (titles of earlier concepts of the list) and "refs", the labels of the passages it comes from, exactly as in the sources. Use only what the sources say. Write in ${writeIn(course.language || currentLang())}.`,
    prompt: context.text,
    shape: CONCEPTS_SHAPE,
    signal,
  });
  const records = conceptRecords(raw, course.id);
  for (const c of records) await put("concepts", c);
  return records;
}
