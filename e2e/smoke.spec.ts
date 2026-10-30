import { expect, test } from "@playwright/test";
import { courseWithNote, mockAi, setUpAi, siteURL, watch } from "./helpers.ts";

test.use({ locale: "en-US" });

test("the app opens clean, in three languages", async ({ page }) => {
  const w = await watch(page);
  await page.goto(siteURL);
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a course" })).toBeVisible();
  await page.getByRole("button", { name: "FR" }).click();
  await expect(page.getByRole("heading", { name: "Aujourd'hui" })).toBeVisible();
  await page.getByRole("button", { name: "DE" }).click();
  await expect(page.getByRole("heading", { name: "Heute" })).toBeVisible();
  await w.assertClean();
});

test("a report cites its sources, and a chat answer is summarised into a note", async ({ page }) => {
  const w = await watch(page);
  const calls = await mockAi(page, (c) => {
    if (c.system.includes("summarise a study conversation")) return "## Clarified\n- Entropy never decreases (Entropy, §1).";
    if (c.system.includes("study assistant")) return "Entropy never decreases in an isolated system [S1 §1].";
    return "## Key ideas\nEntropy measures disorder [S1 §1]. It never decreases [S1 §1, S1 §1].";
  });
  await setUpAi(page);
  await courseWithNote(page);

  await page.getByRole("tab", { name: "Studio" }).click();
  await page.getByRole("button", { name: /^Reports/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("is sent to 127.0.0.1:9.")).toBeVisible();
  await sheet.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("link", { name: /Summary · Lesson 1/ }).click();
  await expect(page.getByText("Entropy measures disorder")).toBeVisible();
  // Grouped labels become links too.
  await expect(page.getByRole("button", { name: "S1 §1" })).toHaveCount(3);
  await page.getByRole("button", { name: "S1 §1" }).first().click();
  await expect(page.getByRole("heading", { name: "Entropy" })).toBeVisible();
  await page.goBack();

  await page.getByRole("link", { name: "Lesson 1" }).click();
  await page.getByRole("tab", { name: "Chat" }).click();
  await page.getByRole("button", { name: "Ask about these sources" }).click();
  await expect(page.getByText("Passages of 1 source go to 127.0.0.1:9 with each question.")).toBeVisible();
  await page.getByLabel("Your question").fill("Can entropy decrease?");
  await page.getByLabel("Your question").press("Enter");
  await expect(page.getByText("never decreases in an isolated system")).toBeVisible();
  expect(calls.find((c) => c.stream)?.last).toBe("Can entropy decrease?");
  await page.getByRole("button", { name: "Summarise the exchange" }).click();
  await expect(page.getByText("Also saved as a note among the sources.")).toBeVisible();
  await page.getByRole("tab", { name: "Sources" }).click();
  await expect(page.getByRole("link", { name: /Exchange summary/ })).toBeVisible();
  await w.assertClean();
});
