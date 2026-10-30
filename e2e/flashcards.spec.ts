import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { courseWithNote, mockAi, setUpAi, watch } from "./helpers.ts";

test.use({ locale: "en-US" });

const CARDS = {
  cards: [
    { kind: "basic", front: "What does entropy measure?", back: "Disorder.", concept: "entropy", source: "S1 §1" },
    { kind: "cloze", text: "In an isolated system entropy never {{c1::decreases}}.", concept: "second law", source: "[S1 §1]" },
    { kind: "basic", front: "Who stated the second law?", back: "Clausius.", concept: "second law", source: "nowhere" },
  ],
};

const studyEvents = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () =>
      new Promise<{ kind: string; score: number; concept?: string; artifactId?: string }[]>((resolve, reject) => {
        const req = indexedDB.open("amphi");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const all = req.result.transaction("events").objectStore("events").getAll();
          all.onsuccess = () => resolve(all.result);
        };
      }),
  );

async function download(page: import("@playwright/test").Page, button: string) {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: button }).click()]);
  const bytes = await readFile((await d.path())!);
  return { name: d.suggestedFilename(), bytes };
}

test("flashcards are generated, edited, reviewed into study events, and exported to Anki and Cursus", async ({ page }) => {
  const w = await watch(page);
  const calls = await mockAi(page, (c) => (c.system.includes("You write flashcards") ? JSON.stringify(CARDS) : "## Key ideas\n- Entropy measures disorder [S1 §1]."));
  await setUpAi(page);
  await courseWithNote(page);

  await page.getByRole("tab", { name: "Studio" }).click();
  await page.getByRole("button", { name: /^Flashcards/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Number of cards").selectOption("10");
  await sheet.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("link", { name: /Flashcards · Lesson 1/ }).click();
  expect(calls.find((c) => c.system.includes("You write flashcards"))?.system).toContain("Write 10 cards");

  const list = page.getByRole("list", { name: "Cards" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list.getByText("What does entropy measure?")).toBeVisible();
  // A cloze card shows its deletion hidden, then answered.
  await expect(list.getByText("In an isolated system entropy never […].")).toBeVisible();
  await expect(list.getByText("In an isolated system entropy never decreases.")).toBeVisible();

  // Filter by concept, edit, add, delete.
  await page.getByLabel("Filter by concept").selectOption("second law");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await page.getByLabel("Filter by concept").selectOption("");
  await list.getByRole("listitem").nth(2).getByRole("button", { name: "Edit the card" }).click();
  await list.getByLabel("Back").fill("Rudolf Clausius.");
  await list.getByRole("button", { name: "Save" }).click();
  await expect(list.getByText("Rudolf Clausius.")).toBeVisible();
  await page.getByRole("button", { name: "Add a card" }).click();
  await page.getByLabel("Front").fill("Unit of entropy?");
  await page.getByLabel("Back").fill("J/K");
  await page.getByLabel("Concept", { exact: true }).fill("entropy");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await list.getByRole("listitem").nth(3).getByRole("button", { name: "Delete the card" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(3);

  // Quick review: each answer is a study event.
  await page.getByRole("button", { name: "Review (3)" }).click();
  await expect(page.getByText("Card 1 of 3")).toBeVisible();
  await page.getByRole("button", { name: "Show the answer" }).click();
  await expect(page.getByText("Disorder.")).toBeVisible();
  await page.getByRole("button", { name: "Knew it" }).click();
  await page.getByRole("button", { name: "Show the answer" }).click();
  await page.getByRole("button", { name: "Didn't know" }).click();
  await page.getByRole("button", { name: "Show the answer" }).click();
  await page.getByRole("button", { name: "Knew it" }).click();
  await expect(page.getByRole("status")).toHaveText("You knew 2 of 3.");
  const events = await studyEvents(page);
  expect(events.map((e) => [e.kind, e.score, e.concept])).toEqual(
    expect.arrayContaining([
      ["card", 1, "entropy"],
      ["card", 0, "second law"],
      ["card", 1, "second law"],
    ]),
  );
  expect(events).toHaveLength(3);
  expect(new Set(events.map((e) => e.artifactId)).size).toBe(1);
  await page.getByRole("button", { name: "Done" }).click();

  // Exports.
  const apkg = await download(page, "Anki (.apkg)");
  expect(apkg.name).toBe("flashcards-lesson-1.apkg");
  expect(Object.keys(unzipSync(apkg.bytes)).sort()).toEqual(["collection.anki2", "media"]);
  const tsv = await download(page, "Anki (text)");
  expect(tsv.name).toBe("flashcards-lesson-1.tsv");
  const text = new TextDecoder().decode(tsv.bytes);
  expect(text.split("\n").slice(0, 5)).toEqual(["#separator:tab", "#html:true", "#deck:Thermodynamics::Lesson 1", "#tags column:3", "#notetype column:4"]);
  expect(text).toContain("What does entropy measure?\t<p>Disorder.</p><p><em>Entropy, §1</em></p>\tThermodynamics Lesson_1 entropy\tBasic\n");
  expect(text).toContain("In an isolated system entropy never {{c1::decreases}}.");
  expect(text).toContain("Thermodynamics Lesson_1 second_law\tCloze");
  const cursus = await download(page, "Cursus");
  expect(cursus.name).toBe("flashcards-lesson-1.cursus-course");
  const pkg = JSON.parse(new TextDecoder().decode(unzipSync(cursus.bytes)["course.json"])) as { format: string; sources: { title: string }[]; cards: unknown[] };
  expect(pkg.format).toBe("cursus-course/1");
  expect(pkg.sources.map((s) => s.title)).toEqual(["Entropy"]);
  expect(pkg.cards).toHaveLength(3);

  // A card's citation opens its passage.
  await list.getByRole("button", { name: "S1 §1" }).first().click();
  await expect(page.getByRole("heading", { name: "Entropy" })).toBeVisible();

  // The whole course, from its page.
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Thermodynamics" }).click();
  const course = await download(page, "Send to Cursus");
  expect(course.name).toBe("thermodynamics.cursus-course");
  const all = JSON.parse(new TextDecoder().decode(unzipSync(course.bytes)["course.json"])) as { sections: { name: string }[]; cards: unknown[] };
  expect(all.sections.map((s) => s.name)).toEqual(["Lesson 1"]);
  expect(all.cards).toHaveLength(3);
  await w.assertClean();
});
