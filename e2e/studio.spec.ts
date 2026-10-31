import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { courseWithNote, mockAi, setUpAi, watch } from "./helpers.ts";

test.use({ locale: "en-US" });

const QUIZ = {
  questions: [
    { kind: "mcq", question: "What does entropy measure?", choices: ["Disorder", "Mass", "Speed", "Charge"], answer: 0, explanation: "Entropy measures disorder [S1 §1].", concept: "Entropy", cite: "S1 §1" },
    { kind: "truefalse", question: "Entropy can decrease in an isolated system.", answer: false, explanation: "The second law says it never decreases [S1 §1].", concept: "Second law", cite: "S1 §1" },
    { kind: "short", question: "What does the second law say about entropy?", answer: "It never decreases in an isolated system", explanation: "Stated in the note [S1 §1].", concept: "Second law", cite: "S1 §1" },
  ],
};

const MINDMAP = {
  title: "Thermodynamics",
  children: [
    { title: "Entropy", cite: "S1 §1", note: "Measures disorder", children: [{ title: "Disorder", cite: "S1 §1" }] },
    { title: "Second law", cite: "S1 §1", children: [{ title: "Never decreases", cite: "S1 §1" }, { title: "Isolated systems" }] },
  ],
};

const INFOGRAPHIC = {
  title: "Entropy at a glance",
  subtitle: "What the note says",
  blocks: [
    { type: "keyFigures", title: "In numbers", items: [{ value: "2nd", label: "law of thermodynamics", cite: "S1 §1" }, { value: "0", label: "decrease in an isolated system" }] },
    { type: "steps", title: "The idea", items: [{ title: "Disorder", text: "Entropy measures it." }, { title: "Isolation", text: "It never decreases." }] },
    { type: "definitions", title: "Terms", items: [{ term: "Entropy", definition: "A measure of disorder.", cite: "S1 §1" }] },
  ],
};

function reply(c: { system: string; last: string }): string {
  if (c.system.includes("grade a student's short answer")) return JSON.stringify({ verdict: "correct", feedback: "Yes: it never decreases." });
  if (c.system.includes("write a quiz")) return JSON.stringify(QUIZ);
  if (c.system.includes("mind map")) return JSON.stringify(MINDMAP);
  if (c.system.includes("infographic")) return JSON.stringify(INFOGRAPHIC);
  return "## Key ideas\nEntropy measures disorder [S1 §1].";
}

async function generate(page: Page, tile: RegExp, link: RegExp) {
  await page.getByRole("tab", { name: "Studio" }).click();
  await page.getByRole("button", { name: tile }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Generate" }).click();
  await page.getByRole("link", { name: link }).click();
}

/** Clicks an export and returns the downloaded file's bytes. */
async function download(page: Page, button: Locator): Promise<{ name: string; bytes: Buffer }> {
  const [d] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const path = await d.path();
  const bytes = readFileSync(path);
  expect(bytes.length, d.suggestedFilename()).toBeGreaterThan(0);
  return { name: d.suggestedFilename(), bytes };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test("a quiz is taken, graded, scored, retried and exported", async ({ page }) => {
  const w = await watch(page);
  const calls = await mockAi(page, reply);
  await setUpAi(page);
  await courseWithNote(page);
  await generate(page, /^Quiz/, /Quiz · Lesson 1/);

  await page.getByRole("button", { name: "One question at a time" }).click();
  await page.getByRole("button", { name: "Start the quiz" }).click();
  await expect(page.getByText("Question 1 of 3")).toBeVisible();
  await page.getByRole("radio", { name: /Disorder/ }).check();
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("Correct", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();

  // The keyboard: Enter on a radio checks the answer.
  await page.getByRole("radio", { name: "True" }).check();
  await page.getByRole("radio", { name: "True" }).press("Enter");
  await expect(page.getByText("Not quite")).toBeVisible();
  await expect(page.getByText("Answer: False")).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();

  await page.getByLabel("Your answer").fill("It never goes down");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("Yes: it never decreases.")).toBeVisible();
  expect(calls.find((c) => c.system.includes("grade a student's short answer"))?.last).toContain("Student's answer: It never goes down");
  await page.getByRole("button", { name: "See the score" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Score" })).toContainText("Score: 2 / 3");

  // Every answer is a study event.
  const events = await page.evaluate(
    () =>
      new Promise<{ kind: string; score: number; concept?: string }[]>((resolve) => {
        const open = indexedDB.open("amphi");
        open.onsuccess = () => {
          const req = open.result.transaction("events").objectStore("events").getAll();
          req.onsuccess = () => resolve(req.result);
        };
      }),
  );
  expect(events.map((e) => [e.kind, e.score, e.concept])).toEqual(
    expect.arrayContaining([
      ["quiz", 1, "Entropy"],
      ["quiz", 0, "Second law"],
      ["quiz", 1, "Second law"],
    ]),
  );

  await page.getByRole("button", { name: "Retry the missed ones (1)" }).click();
  await expect(page.getByText("Question 1 of 1")).toBeVisible();
  await expect(page.getByText("Entropy can decrease in an isolated system.")).toBeVisible();

  const md = await download(page, page.getByRole("button", { name: "Markdown (questions and answers)" }));
  expect(md.name).toBe("quiz-lesson-1.md");
  expect(md.bytes.toString()).toContain("1. **A. Disorder**: Entropy measures disorder [S1 §1].");

  // An explanation's citation opens the passage.
  await page.getByRole("radio", { name: "False" }).check();
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: "S1 §1" }).first().click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Entropy" })).toBeVisible();
  await w.assertClean();
});

test("a mind map of the whole course is edited, zoomed and exported", async ({ page }) => {
  const w = await watch(page);
  await mockAi(page, reply);
  await setUpAi(page);
  await courseWithNote(page);
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Thermodynamics" }).click();
  await generate(page, /^Mind map/, /Mind map · Thermodynamics/);

  const tree = page.getByRole("tree", { name: "Mind map: Thermodynamics" });
  await expect(tree.getByRole("treeitem", { name: "Entropy" })).toBeVisible();

  // Rename with a double click.
  await tree.getByRole("treeitem", { name: "Entropy" }).dblclick();
  await page.getByLabel("Name of the idea").fill("Entropy and disorder");
  await page.getByLabel("Name of the idea").press("Enter");
  await expect(tree.getByRole("treeitem", { name: "Entropy and disorder" })).toBeFocused();

  // The keyboard: add a child, rename it, move to its parent, fold the branch.
  await page.keyboard.press("Control+Enter");
  await page.getByLabel("Name of the idea").fill("Heat death");
  await page.getByLabel("Name of the idea").press("Enter");
  await expect(tree.getByRole("treeitem", { name: "Heat death" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tree.getByRole("treeitem", { name: "Entropy and disorder" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(tree.getByRole("treeitem", { name: "Entropy and disorder" })).toHaveAttribute("aria-expanded", "false");
  await expect(tree.getByRole("treeitem", { name: "Heat death" })).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(tree.getByRole("treeitem", { name: "Heat death" })).toBeVisible();

  // Zoom with the buttons and the keyboard, then fit.
  const zoom = page.locator(".mm-zoom");
  const before = await zoom.textContent();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).not.toHaveText(before ?? "");
  await page.getByRole("button", { name: "Fit to screen" }).click();
  await expect(zoom).toHaveText(before ?? "");

  // The outline says the same.
  await page.getByRole("button", { name: "Outline", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: /^Heat death$/ })).toBeVisible();
  await page.getByRole("button", { name: "Map", exact: true }).click();

  const svg = await download(page, page.getByRole("button", { name: "SVG image" }));
  expect(svg.name).toBe("mind-map-thermodynamics.svg");
  expect(svg.bytes.toString()).toContain("Heat death");
  expect(svg.bytes.toString()).toContain('xmlns="http://www.w3.org/2000/svg"');
  const png = await download(page, page.getByRole("button", { name: "PNG image" }));
  expect(png.bytes.subarray(0, 4).equals(PNG)).toBe(true);
  const md = await download(page, page.getByRole("button", { name: "Markdown outline" }));
  expect(md.bytes.toString()).toContain("- Entropy and disorder: Measures disorder [S1 §1]\n  - Disorder [S1 §1]\n  - Heat death");

  // Edits are kept.
  await page.reload();
  await expect(page.getByRole("tree").getByRole("treeitem", { name: "Heat death" })).toBeVisible();
  await w.assertClean();
});

test("an infographic is drawn from blocks, cites its sources and exports as images", async ({ page }) => {
  const w = await watch(page);
  await mockAi(page, reply);
  await setUpAi(page);
  await courseWithNote(page);
  await generate(page, /^Infographic/, /Infographic · Lesson 1/);

  const figure = page.getByRole("group", { name: "Entropy at a glance" });
  await expect(figure).toBeVisible();
  await expect(figure.getByText("law of thermodynamics", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Text", exact: true }).click();
  await expect(page.getByText("A measure of disorder.")).toBeVisible();
  await page.getByRole("button", { name: "Image", exact: true }).click();

  const svg = await download(page, page.getByRole("button", { name: "SVG image" }));
  expect(svg.bytes.toString()).toContain("Entropy at a glance");
  const png = await download(page, page.getByRole("button", { name: "PNG image" }));
  expect(png.bytes.subarray(0, 4).equals(PNG)).toBe(true);

  await figure.getByRole("button", { name: "S1 §1" }).first().click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Entropy" })).toBeVisible();
  await w.assertClean();
});
