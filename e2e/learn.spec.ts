import { expect, type Page, test } from "@playwright/test";
import { courseWithNote, mockAi, setUpAi, siteURL, watch } from "./helpers.ts";

test.use({ locale: "en-US" });

const PLAN = {
  title: "Thermodynamics",
  overview: "How heat, work and energy relate.",
  concepts: [
    { title: "Energy", summary: "What can do work. It is conserved in an isolated system.", prerequisites: [] },
    { title: "Entropy", summary: "A measure of disorder.", prerequisites: ["Energy"] },
    { title: "The second law", summary: "Entropy never decreases in an isolated system.", prerequisites: ["Entropy"] },
  ],
  readings: [
    { title: "Fermi, Thermodynamics", why: "Short and clear for a first pass.", level: "beginner", url: "https://invented.example/fermi" },
    { title: "Callen, Thermodynamics", why: "The classic, for later.", level: "advanced" },
  ],
};

const CONCEPTS = {
  concepts: [
    { title: "Entropy", summary: "Entropy measures disorder [S1 §1].", prerequisites: [], refs: ["S1 §1"] },
    { title: "The second law of thermodynamics", summary: "Entropy never decreases in an isolated system [S1 §1].", prerequisites: ["Entropy"], refs: ["S1 §1"] },
  ],
};

const QUIZ = {
  questions: [
    { kind: "mcq", question: "What does entropy measure?", choices: ["Disorder", "Mass", "Speed", "Charge"], answer: 0, explanation: "Entropy measures disorder [S1 §1].", concept: "Entropy", cite: "S1 §1" },
    { kind: "truefalse", question: "Entropy can decrease in an isolated system.", answer: false, explanation: "The second law says it never decreases [S1 §1].", concept: "Second law", cite: "S1 §1" },
    { kind: "short", question: "What does the second law say about entropy?", answer: "It never decreases in an isolated system", explanation: "Stated in the note [S1 §1].", concept: "Second law", cite: "S1 §1" },
  ],
};

function reply(c: { system: string; last: string }): string {
  if (c.system.includes("You map a topic")) return JSON.stringify(PLAN);
  if (c.system.includes("concepts a student must master")) return JSON.stringify(CONCEPTS);
  if (c.system.includes("grade a student's short answer")) return JSON.stringify({ verdict: "incorrect", feedback: "No: it never decreases." });
  if (c.system.includes("write a quiz")) return JSON.stringify(QUIZ);
  if (c.system.includes("You summarise a study conversation")) return "**Clarified**: entropy never decreases in an isolated system.\n\n**Open**: why heat flows from hot to cold.";
  if (c.system.includes("You assess how well a student understood")) return JSON.stringify({ score: 0.3, reason: "The student needed several hints." });
  if (c.system.includes("Socratic tutor")) return "Good start. What happens to the entropy of an isolated system over time?";
  return "## Key ideas\nEntropy measures disorder [S1 §1].";
}

const conceptItem = (page: Page, name: string) => page.locator(".concept").filter({ has: page.getByRole("heading", { name, exact: true }) });

test("a topic is discovered without web search: a plan, unsourced readings, concepts and a mind map", async ({ page }) => {
  const w = await watch(page);
  const calls = await mockAi(page, reply);
  await setUpAi(page);
  await page.goto(`${siteURL}#/discover`);
  await page.getByLabel("Topic").fill("Thermodynamics");
  await page.getByLabel("Your goal").selectOption("exam");
  // The mocked server has no web search: said before anything is sent.
  await expect(page.getByText(/This model cannot search the web/)).toBeVisible();
  await expect(page.getByText(/Your topic, level and goal are sent to 127\.0\.0\.1:9/)).toBeVisible();
  await page.getByRole("button", { name: "Map the topic" }).click();

  await expect(page.getByRole("heading", { name: "Thermodynamics", level: 2 })).toBeVisible();
  await expect(page.getByText("A measure of disorder.")).toBeVisible();
  const call = calls.find((c) => c.system.includes("You map a topic"))!;
  expect(call.system).toContain("Never give a URL");
  expect(call.last).toContain("Topic: Thermodynamics");
  expect(call.last).toContain("pass an exam");

  // Readings: unsourced, never with the URL the model made up, unticked until chosen.
  const readings = page.getByRole("group", { name: "Reading suggestions (unsourced, to verify)" });
  await expect(readings.getByText("Unsourced, to verify", { exact: true })).toHaveCount(2);
  await expect(page.getByText("invented.example")).toHaveCount(0);
  const fermi = readings.getByRole("checkbox", { name: /Fermi, Thermodynamics/ });
  await expect(fermi).not.toBeChecked();
  await fermi.check();
  await expect(page.getByText("Creates the topic with 3 concepts, 1 note and a mind map.")).toBeVisible();
  await page.getByRole("button", { name: "Create the topic" }).click();

  await expect(page.getByRole("heading", { name: "Thermodynamics", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Fermi, Thermodynamics/ })).toBeVisible();
  await page.getByRole("link", { name: /Fermi, Thermodynamics/ }).click();
  await expect(page.getByText("Suggested without a web search: unsourced, to verify.")).toBeVisible();
  await page.goBack();

  await page.getByRole("tab", { name: "Progress" }).click();
  await expect(page.getByRole("heading", { name: "Energy", exact: true })).toBeVisible();
  await expect(conceptItem(page, "The second law")).toContainText("Builds on: Entropy");
  await expect(conceptItem(page, "Energy")).toContainText("Not studied yet");

  // Reordering keeps the list consistent.
  await page.getByRole("button", { name: "Move “Entropy” up" }).click();
  await expect(page.locator(".concept-title").first()).toHaveText("Entropy");

  await page.getByRole("tab", { name: "Studio" }).click();
  await page.getByRole("link", { name: /Mind map · Thermodynamics/ }).click();
  const tree = page.getByRole("tree", { name: "Mind map: Thermodynamics" });
  await expect(tree.getByRole("treeitem", { name: "Energy" })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "The second law" })).toBeVisible();
  await w.assertClean();
});

async function takeQuiz(page: Page) {
  await page.getByRole("tab", { name: "Studio" }).click();
  await page.getByRole("button", { name: /^Quiz/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Generate" }).click();
  await page.getByRole("link", { name: /Quiz · Thermodynamics/ }).click();
  await page.getByRole("button", { name: "One question at a time" }).click();
  await page.getByRole("button", { name: "Start the quiz" }).click();
  await page.getByRole("radio", { name: /Disorder/ }).check();
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByRole("radio", { name: "True" }).check();
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByLabel("Your answer").fill("It goes up and down");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("No: it never decreases.")).toBeVisible();
  await page.getByRole("button", { name: "See the score" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Score" })).toContainText("Score: 1 / 3");
}

test("progress: concepts from the sources, mastery from a quiz, self-assessment, a tutor session, a review on Today", async ({ page }) => {
  const w = await watch(page);
  const calls = await mockAi(page, reply);
  await setUpAi(page);
  await courseWithNote(page);
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Thermodynamics" }).click();
  await page.getByRole("tab", { name: "Progress" }).click();
  await expect(page.getByText("The text of 1 source is sent to 127.0.0.1:9.")).toBeVisible();
  await page.getByRole("button", { name: "Find the concepts in the sources" }).click();
  const second = conceptItem(page, "The second law of thermodynamics");
  await expect(second).toContainText("Builds on: Entropy");
  await expect(second).toContainText("Not studied yet");
  expect(calls.find((c) => c.system.includes("concepts a student must master"))?.last).toContain("Entropy measures disorder.");

  // The quiz names "Second law": its answers count for "The second law of thermodynamics".
  await takeQuiz(page);
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Thermodynamics" }).click();
  await page.getByRole("tab", { name: "Progress" }).click();
  await expect(conceptItem(page, "Entropy")).toContainText("Mastery 3/4");
  await expect(second).toContainText("Mastery 0/4");
  await expect(page.getByRole("link", { name: /Quiz · Thermodynamics Last score: 1 \/ 3 · best 33 % · 1 attempt/ })).toBeVisible();

  await conceptItem(page, "Entropy").getByRole("group", { name: "How well do you know “Entropy”?" }).getByRole("button", { name: "Got it" }).click();
  await expect(conceptItem(page, "Entropy")).toContainText("Mastery 4/4");

  // The tutor: a Socratic chat on the concept, ended with a summary and a score.
  await second.getByRole("button", { name: "Work on it with the tutor" }).click();
  await expect(page.getByRole("heading", { name: "Tutor: The second law of thermodynamics" })).toBeVisible();
  await expect(page.getByText("Let's work on “The second law of thermodynamics”.", { exact: false })).toBeVisible();
  await page.getByLabel("Your question").fill("It says entropy grows, I think.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Good start. What happens to the entropy")).toBeVisible();
  const tutorCall = calls.find((c) => c.system.includes("Socratic tutor"))!;
  expect(tutorCall.system).toContain('The concept of this session: "The second law of thermodynamics"');
  await page.getByRole("button", { name: "End the session" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Session ended" })).toHaveText("Session ended. Understanding: 30 %.");
  await expect(page.getByText("Summary of the exchange")).toBeVisible();
  expect(calls.find((c) => c.system.includes("You assess how well"))?.last).toContain("Student: It says entropy grows, I think.");
  await page.getByRole("button", { name: "All concepts" }).click();
  await expect(second).toContainText("Mastery 0/4");
  await expect(second).toContainText("3 signs");

  // The tutor's conversation stays out of the course chat; its summary joins the sources.
  await page.getByRole("tab", { name: "Chat" }).click();
  await expect(page.getByText("No conversation yet")).toBeVisible();
  await page.getByRole("tab", { name: "Sources" }).click();
  await expect(page.getByRole("link", { name: /Exchange summary · Tutor · The second law/ })).toBeVisible();

  await page.goto(`${siteURL}#/`);
  await expect(page.getByText("Review “The second law of thermodynamics”: it is still shaky.")).toBeVisible();
  await page.getByRole("link", { name: "Review" }).first().click();
  await expect(page.getByRole("tab", { name: "Progress" })).toHaveAttribute("aria-selected", "true");
  await w.assertClean();
});
