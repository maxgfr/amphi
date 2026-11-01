import { expect, test } from "@playwright/test";
import { courseWithNote, siteURL, watch } from "./helpers.ts";

test.use({ locale: "en-US" });

test("deleting goes to the trash: undo, restore with what was inside, empty it", async ({ page }) => {
  const w = await watch(page);
  await courseWithNote(page);
  const lesson = page.url();

  // A note: gone at once, back with Undo.
  await page.getByRole("button", { name: "Delete Entropy" }).click();
  await expect(page.getByRole("link", { name: /Entropy/ })).toBeHidden();
  const toast = page.locator(".toast").filter({ hasText: "“Entropy” is in the trash." });
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("link", { name: /Entropy/ })).toBeVisible();

  // A lesson: no confirmation, the course opens, the lesson waits in the trash with its note.
  await page.getByRole("button", { name: "Delete the lesson" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thermodynamics" })).toBeVisible();
  await page.goto(`${siteURL}#/courses`);
  await page.getByRole("link", { name: "Trash · 1" }).click();
  await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
  await expect(page.getByText("Lesson · in Thermodynamics · with 1 item")).toBeVisible();
  await page.getByRole("button", { name: "Restore “Lesson 1”" }).click();
  await expect(page.getByText("The trash is empty")).toBeVisible();
  await page.goto(lesson);
  await expect(page.getByRole("link", { name: /Entropy/ })).toBeVisible();

  // The course, then the trash emptied for good.
  await page.getByRole("link", { name: "Thermodynamics" }).first().click();
  await page.getByRole("button", { name: "Delete the course" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Courses" })).toBeVisible();
  await page.getByRole("link", { name: "Trash · 1" }).click();
  await expect(page.getByText("Course · with 2 items")).toBeVisible();
  await page.getByRole("button", { name: "Empty the trash" }).click();
  await page.getByRole("button", { name: "Delete everything for good" }).click();
  await expect(page.getByText("The trash is empty")).toBeVisible();
  await w.assertClean();
});

test("the trash lets go of what it has kept for 30 days", async ({ page }) => {
  const w = await watch(page);
  await page.clock.install({ time: new Date("2026-03-01T10:00:00Z") });
  await courseWithNote(page);
  await page.getByRole("button", { name: "Delete Entropy" }).click();
  await page.goto(`${siteURL}#/trash`);
  await expect(page.getByText("gone for good in 30 days")).toBeVisible();
  await page.clock.setSystemTime(new Date("2026-04-01T10:00:00Z"));
  await page.reload();
  await expect(page.getByText("The trash is empty")).toBeVisible();
  await w.assertClean();
});
