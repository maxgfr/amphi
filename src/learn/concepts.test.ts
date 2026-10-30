import { expect, test } from "bun:test";
import { ConceptsAnswer, conceptRecords, conceptRule as rule, conceptTree } from "./concepts.ts";

test("concepts keep their order, once each, with prerequisites linked by name", () => {
  const raw = ConceptsAnswer.parse({
    concepts: [
      { title: "Energy", summary: "What can do work. It is conserved.", refs: ["[S1 p.2]", "nonsense"] },
      { title: "  Entropy ", summary: "Disorder [S1 p.3].", prerequisites: ["energy"] },
      { title: "entropy", summary: "duplicate" },
      { title: "The second law of thermodynamics", prerequisites: ["Entropy", "Energy", "Unknown"] },
    ],
  });
  const cs = conceptRecords(raw, "c1", 1000);
  expect(cs.map((c) => [c.title, c.order])).toEqual([
    ["Energy", 1],
    ["Entropy", 2],
    ["The second law of thermodynamics", 3],
  ]);
  expect(cs[0]!.refs).toEqual(["S1 p.2"]);
  expect(cs[1]!.prerequisites).toEqual([cs[0]!.id]);
  expect(cs[2]!.prerequisites).toEqual([cs[1]!.id, cs[0]!.id]);
  expect(cs.every((c) => c.courseId === "c1" && c.createdAt === 1000)).toBe(true);
});

test("a bare array is a concepts answer; an empty one is not", () => {
  expect(ConceptsAnswer.safeParse([{ title: "A" }]).success).toBe(true);
  expect(ConceptsAnswer.safeParse({ concepts: [] }).success).toBe(false);
});

test("the topic's mind map hangs each concept under its last prerequisite", () => {
  const cs = conceptRecords(
    [{ title: "Heat", summary: "First. Second sentence." }, { title: "Work", prerequisites: ["heat"] }, { title: "Energy", prerequisites: ["Work"] }, { title: "Entropy", prerequisites: ["Energy"] }, { title: "Engines" }],
    "c1",
  );
  const root = conceptTree("Topic", cs);
  expect(root.title).toBe("Topic");
  expect(root.children.map((n) => n.title)).toEqual(["Heat", "Engines"]);
  expect(root.children[0]!.note).toBe("First.");
  const b = root.children[0]!.children[0]!;
  expect(b.title).toBe("Work");
  // Four levels at most: Entropy goes beside Energy rather than under it.
  expect(b.children.map((n) => n.title)).toEqual(["Energy", "Entropy"]);
});

test("quizzes and cards are told the course's concept names", () => {
  expect(rule([])).toBe("");
  const r = rule([{ title: "Entropy" }, { title: 'The "second" law' }]);
  expect(r).toContain('"Entropy", "The \\"second\\" law"');
  expect(r).toContain("use that name exactly");
});
