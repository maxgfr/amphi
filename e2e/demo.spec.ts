import { expect, test } from "@playwright/test";
import { siteURL, watch } from "./helpers.ts";

test.use({ locale: "en-US" });

test("the demo loads from Settings, every part of it opens without an AI key, and it leaves in one click", async ({ page }) => {
  const w = await watch(page);
  await page.goto(siteURL);
  await page.getByRole("link", { name: "Or look around a demo course first" }).click();
  await page.getByRole("button", { name: "Load the demo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thermodynamics" })).toBeVisible();

  await page.getByRole("tab", { name: "Studio" }).click();
  await page.getByRole("link", { name: /Summary · Thermodynamics/ }).click();
  await expect(page.getByText("The energy of an isolated system is conserved")).toBeVisible();
  await page.goBack();
  await page.getByRole("link", { name: /Quiz · Thermodynamics/ }).click();
  await page.getByRole("button", { name: "Start the quiz" }).click();
  await expect(page.getByText("What does entropy measure?")).toBeVisible();
  await page.goBack();
  await page.getByRole("link", { name: /Flashcards · Thermodynamics/ }).click();
  await expect(page.getByText("The first law as a formula?")).toBeVisible();

  await page.goto(siteURL);
  await expect(page.getByText("Thermodynamics: exam in 12 days.", { exact: false })).toBeVisible();
  await page.goto(`${siteURL}#/courses`);
  await expect(page.getByRole("main").getByRole("link", { name: /Photosynthesis/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Trash · 1" })).toBeVisible();

  await page.goto(`${siteURL}#/settings/demo`);
  await page.getByRole("button", { name: "Remove the demo" }).click();
  await expect(page.getByRole("button", { name: "Load the demo" })).toBeVisible();
  await page.goto(`${siteURL}#/courses`);
  await expect(page.getByText("No course yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Trash", exact: true })).toBeVisible();
  await w.assertClean();
});
