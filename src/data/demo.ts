// The demo: a course and a topic already filled in (notes, concepts with some
// mastery, a summary, a quiz, flashcards, mind maps, a learning path, a note
// in the trash), so every part of amphi can be tried before importing
// anything and without an AI key. Its courses carry `demo`, so it leaves in
// one click. The material is in French or English (German gets English).

import { conceptRecords, conceptTree } from "../learn/concepts.ts";
import type { QuizData } from "../studio/quiz-core.ts";
import type { FlashcardsData } from "../studio/cards.ts";
import type { MindmapData } from "../studio/render/mindmap-tree.ts";
import type { ReportData } from "../studio/report.tsx";
import { fresh, listAll, put, removeCourse, trash } from "./db.ts";
import type { Artifact, Course, Id } from "./schema.ts";

const DAY = 86_400_000;

interface Material {
  course: string;
  lesson1: string;
  lesson2: string;
  notes: [string, string][];
  concepts: { title: string; summary: string; prerequisites: string[] }[];
  summary: string;
  quiz: QuizData["questions"];
  cards: FlashcardsData["cards"];
  topic: string;
  topicGoal: string;
  topicNotes: [string, string, string][];
  topicConcepts: { title: string; summary: string; prerequisites: string[] }[];
  path: [string, string][];
  trashed: [string, string];
  words: { summary: string; quiz: string; cards: string; map: string };
}

const FR: Material = {
  course: "Thermodynamique",
  lesson1: "Énergie et premier principe",
  lesson2: "Entropie et second principe",
  notes: [
    ["Notes du cours 1", "L'énergie d'un système isolé se conserve : c'est le premier principe.\n\nLa chaleur et le travail sont deux façons d'échanger de l'énergie avec l'extérieur. ΔU = Q + W."],
    ["Notes du cours 2", "L'entropie mesure le nombre de micro-états compatibles avec ce que l'on observe : le désordre.\n\nDans un système isolé, l'entropie ne diminue jamais : c'est le second principe.\n\nC'est pour cela que la chaleur va du chaud vers le froid."],
  ],
  concepts: [
    { title: "Énergie interne", summary: "L'énergie que contient un système ; elle se conserve s'il est isolé.", prerequisites: [] },
    { title: "Premier principe", summary: "ΔU = Q + W : l'énergie reçue en chaleur et en travail change l'énergie interne.", prerequisites: ["Énergie interne"] },
    { title: "Entropie", summary: "Le nombre de micro-états compatibles avec l'état observé, à un logarithme près.", prerequisites: ["Énergie interne"] },
    { title: "Second principe", summary: "L'entropie d'un système isolé ne diminue jamais.", prerequisites: ["Entropie"] },
  ],
  summary: "## L'essentiel\n\n- L'énergie d'un système isolé se conserve [S1 §1].\n- Chaleur et travail échangent de l'énergie : ΔU = Q + W [S1 §2].\n- L'entropie mesure le désordre [S2 §1] et ne diminue jamais dans un système isolé [S2 §2].\n- D'où le sens des échanges de chaleur, du chaud vers le froid [S2 §3].",
  quiz: [
    { id: "q1", kind: "mcq", question: "Que mesure l'entropie ?", choices: ["Le désordre", "La masse", "La vitesse", "La charge"], answer: 0, explanation: "L'entropie mesure le nombre de micro-états, le désordre [S2 §1].", concept: "Entropie", cite: "S2 §1" },
    { id: "q2", kind: "truefalse", question: "L'entropie d'un système isolé peut diminuer.", answer: false, explanation: "Le second principe dit qu'elle ne diminue jamais [S2 §2].", concept: "Second principe", cite: "S2 §2" },
    { id: "q3", kind: "short", question: "Qu'énonce le premier principe ?", answer: "L'énergie d'un système isolé se conserve", explanation: "ΔU = Q + W [S1 §2].", concept: "Premier principe", cite: "S1 §1" },
  ],
  cards: [
    { id: "c1", kind: "basic", front: "Le premier principe en une formule ?", back: "ΔU = Q + W", concept: "Premier principe", cite: "S1 §2" },
    { id: "c2", kind: "cloze", front: "Dans un système isolé, l'entropie ne {{c1::diminue jamais}}.", back: "", concept: "Second principe", cite: "S2 §2" },
    { id: "c3", kind: "basic", front: "Pourquoi la chaleur va-t-elle du chaud vers le froid ?", back: "Parce que l'entropie totale augmente ainsi.", concept: "Second principe", cite: "S2 §3" },
  ],
  topic: "Photosynthèse",
  topicGoal: "Culture générale",
  topicNotes: [
    ["Photosynthèse (Wikipédia)", "https://fr.wikipedia.org/wiki/Photosynth%C3%A8se", "La photosynthèse convertit l'énergie lumineuse en énergie chimique : les plantes fabriquent du glucose à partir de CO₂ et d'eau, et libèrent du dioxygène."],
    ["Chloroplaste (Wikipédia)", "https://fr.wikipedia.org/wiki/Chloroplaste", "Le chloroplaste est l'organite où a lieu la photosynthèse ; la chlorophylle y capte la lumière."],
  ],
  topicConcepts: [
    { title: "Chlorophylle", summary: "Le pigment vert qui capte la lumière.", prerequisites: [] },
    { title: "Phase lumineuse", summary: "La lumière coupe l'eau : du dioxygène est libéré, de l'énergie est stockée (ATP).", prerequisites: ["Chlorophylle"] },
    { title: "Cycle de Calvin", summary: "Le CO₂ est fixé en sucres grâce à l'énergie de la phase lumineuse.", prerequisites: ["Phase lumineuse"] },
  ],
  path: [
    ["Capter la lumière", "Dire ce que fait la chlorophylle et ce que produit la phase lumineuse."],
    ["Fabriquer du sucre", "Expliquer comment le cycle de Calvin fixe le CO₂."],
  ],
  trashed: ["Brouillon à jeter", "Une note mise à la corbeille : restaurez-la depuis Cours › Corbeille."],
  words: { summary: "Résumé", quiz: "Quiz", cards: "Cartes", map: "Carte mentale" },
};

const EN: Material = {
  course: "Thermodynamics",
  lesson1: "Energy and the first law",
  lesson2: "Entropy and the second law",
  notes: [
    ["Lecture 1 notes", "The energy of an isolated system is conserved: this is the first law.\n\nHeat and work are two ways to exchange energy with the outside. ΔU = Q + W."],
    ["Lecture 2 notes", "Entropy measures how many microstates fit what we observe: disorder.\n\nIn an isolated system, entropy never decreases: this is the second law.\n\nThat is why heat flows from hot to cold."],
  ],
  concepts: [
    { title: "Internal energy", summary: "The energy a system holds; it is conserved when the system is isolated.", prerequisites: [] },
    { title: "First law", summary: "ΔU = Q + W: energy received as heat and work changes the internal energy.", prerequisites: ["Internal energy"] },
    { title: "Entropy", summary: "How many microstates fit the observed state, up to a logarithm.", prerequisites: ["Internal energy"] },
    { title: "Second law", summary: "The entropy of an isolated system never decreases.", prerequisites: ["Entropy"] },
  ],
  summary: "## Key ideas\n\n- The energy of an isolated system is conserved [S1 §1].\n- Heat and work exchange energy: ΔU = Q + W [S1 §2].\n- Entropy measures disorder [S2 §1] and never decreases in an isolated system [S2 §2].\n- Hence the direction of heat, from hot to cold [S2 §3].",
  quiz: [
    { id: "q1", kind: "mcq", question: "What does entropy measure?", choices: ["Disorder", "Mass", "Speed", "Charge"], answer: 0, explanation: "Entropy counts microstates: disorder [S2 §1].", concept: "Entropy", cite: "S2 §1" },
    { id: "q2", kind: "truefalse", question: "The entropy of an isolated system can decrease.", answer: false, explanation: "The second law says it never decreases [S2 §2].", concept: "Second law", cite: "S2 §2" },
    { id: "q3", kind: "short", question: "What does the first law say?", answer: "The energy of an isolated system is conserved", explanation: "ΔU = Q + W [S1 §2].", concept: "First law", cite: "S1 §1" },
  ],
  cards: [
    { id: "c1", kind: "basic", front: "The first law as a formula?", back: "ΔU = Q + W", concept: "First law", cite: "S1 §2" },
    { id: "c2", kind: "cloze", front: "In an isolated system, entropy {{c1::never decreases}}.", back: "", concept: "Second law", cite: "S2 §2" },
    { id: "c3", kind: "basic", front: "Why does heat flow from hot to cold?", back: "Because total entropy increases that way.", concept: "Second law", cite: "S2 §3" },
  ],
  topic: "Photosynthesis",
  topicGoal: "General knowledge",
  topicNotes: [
    ["Photosynthesis (Wikipedia)", "https://en.wikipedia.org/wiki/Photosynthesis", "Photosynthesis turns light energy into chemical energy: plants make glucose from CO₂ and water, and release oxygen."],
    ["Chloroplast (Wikipedia)", "https://en.wikipedia.org/wiki/Chloroplast", "The chloroplast is the organelle where photosynthesis happens; chlorophyll there captures light."],
  ],
  topicConcepts: [
    { title: "Chlorophyll", summary: "The green pigment that captures light.", prerequisites: [] },
    { title: "Light reactions", summary: "Light splits water: oxygen is released and energy is stored (ATP).", prerequisites: ["Chlorophyll"] },
    { title: "Calvin cycle", summary: "CO₂ is fixed into sugars with the energy of the light reactions.", prerequisites: ["Light reactions"] },
  ],
  path: [
    ["Catching light", "Say what chlorophyll does and what the light reactions make."],
    ["Making sugar", "Explain how the Calvin cycle fixes CO₂."],
  ],
  trashed: ["Draft to throw away", "A note put in the trash: restore it from Courses › Trash."],
  words: { summary: "Summary", quiz: "Quiz", cards: "Flashcards", map: "Mind map" },
};

const isDemo = (c: Course) => Boolean(c.demo) && !c.deletedAt;

export async function hasDemo(): Promise<boolean> {
  return (await listAll("courses")).some(isDemo);
}

/** Fill amphi with the demo, in the interface's language. */
export async function loadDemo(lang: string, now = Date.now()): Promise<Course> {
  const m = lang.startsWith("fr") ? FR : EN;
  const language = lang.startsWith("fr") ? "fr" : "en";
  const exam = new Date(now + 12 * DAY).toISOString().slice(0, 10);
  const course = await put("courses", { ...fresh(now), kind: "course", title: m.course, hue: 2, language, examDate: exam, demo: true });
  const lessons = await Promise.all(
    [m.lesson1, m.lesson2].map((title, i) => put("lessons", { ...fresh(now - (2 - i) * DAY), courseId: course.id, title, order: i + 1, date: new Date(now - (2 - i) * 7 * DAY).toISOString().slice(0, 10) })),
  );
  const sources = await Promise.all(m.notes.map(([title, text], i) => put("sources", { ...fresh(now + i), courseId: course.id, lessonId: lessons[i]!.id, kind: "text", title, text, status: "ready" })));
  const concepts = conceptRecords(m.concepts, course.id, now);
  for (const c of concepts) await put("concepts", c);
  // Some mastery: the first concepts known, entropy shaky, so Today has something to review.
  const scores = [1, 0.75, 0.2, 0.5];
  for (const [i, c] of concepts.entries()) for (const k of [0, 1]) await put("events", { ...fresh(now - (k + 1) * DAY), courseId: course.id, conceptId: c.id, kind: "self", score: scores[i]!, at: now - (k + 1) * DAY });
  const sourceIds: Id[] = sources.map((s) => s.id);
  const made = (type: Artifact["type"], title: string, data: unknown): Artifact => ({ ...fresh(now), courseId: course.id, type, title: `${title} · ${m.course}`, sourceIds, options: {}, language, data, status: "ready", version: 1 });
  await put("artifacts", made("report", m.words.summary, { format: "summary", markdown: m.summary } satisfies ReportData));
  await put("artifacts", made("quiz", m.words.quiz, { questions: m.quiz } satisfies QuizData));
  await put("artifacts", made("flashcards", m.words.cards, { cards: m.cards } satisfies FlashcardsData));
  await put("artifacts", { ...made("mindmap", m.words.map, { root: conceptTree(m.course, concepts) } satisfies MindmapData), sourceIds: [] });
  const junk = await put("sources", { ...fresh(now), courseId: course.id, kind: "text", title: m.trashed[0], text: m.trashed[1], status: "ready" });
  await trash("sources", junk.id, now - 3 * DAY);

  const topic = await put("courses", { ...fresh(now), kind: "topic", title: m.topic, hue: 4, language, goal: m.topicGoal, level: "beginner", seed: "topic", searchedAt: now - DAY, demo: true });
  const topicConcepts = conceptRecords(m.topicConcepts, topic.id, now);
  for (const c of topicConcepts) await put("concepts", c);
  const path = await Promise.all(m.path.map(([title, goal], i) => put("lessons", { ...fresh(now + i), courseId: topic.id, title, goal, order: i + 1, conceptIds: i === 0 ? topicConcepts.slice(0, 2).map((c) => c.id) : topicConcepts.slice(2).map((c) => c.id) })));
  for (const [i, [title, url, text]] of m.topicNotes.entries()) await put("sources", { ...fresh(now + i), courseId: topic.id, lessonId: path[i]!.id, kind: "web", title, url, text, status: "ready" });
  await put("artifacts", { ...fresh(now), courseId: topic.id, type: "mindmap", title: `${m.words.map} · ${m.topic}`, sourceIds: [], options: { detail: "compact", focus: "" }, language, data: { root: conceptTree(m.topic, topicConcepts) } satisfies MindmapData, status: "ready", version: 1 });
  return course;
}

/** Take the demo away, everything in it included. */
export async function removeDemo(): Promise<void> {
  for (const c of (await listAll("courses")).filter(isDemo)) await removeCourse(c.id);
}
