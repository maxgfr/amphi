// The whole path against a real provider: every Studio kind, its exports, the
// chat and its summary, concepts and the tutor, Discover with web search, and
// the voices that run on the device. Opt-in and never in CI: it spends tokens
// and downloads the voice models.
//
//   AMPHI_LIVE_KEY=sk-ant-... bun run e2e:live
//
// AMPHI_LIVE_PROVIDER picks another provider of the settings (default
// "anthropic"); the model is the one the settings recommend.

import { readFileSync } from "node:fs";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { siteURL, watch } from "./helpers.ts";

const key = process.env.AMPHI_LIVE_KEY;
const provider = process.env.AMPHI_LIVE_PROVIDER ?? "anthropic";

test.skip(!key, "set AMPHI_LIVE_KEY to run against a real provider");
test.use({ locale: "en-US" });
test.describe.configure({ mode: "serial", timeout: 300_000 });

const NOTE = `# Premier principe de la thermodynamique

Pour un système fermé, la variation d'énergie interne est ΔU = W + Q, où W est le travail reçu et Q la chaleur reçue. L'énergie interne U est une fonction d'état : sa variation ne dépend que des états initial et final.

## Gaz parfait

Un gaz parfait suit PV = nRT, avec R = 8,314 J/(mol·K). Son énergie interne ne dépend que de la température (première loi de Joule) : ΔU = n Cv ΔT.

## Transformations

- Isotherme : ΔU = 0 donc Q = -W.
- Isochore : W = 0 donc ΔU = Q.
- Isobare : Q = ΔH = n Cp ΔT.
- Adiabatique : Q = 0, ΔU = W et PV^γ = constante.

## Relation de Mayer

Cp - Cv = R. Pour un gaz diatomique à température ambiante, γ = 7/5.`;

const KINDS: { tile: RegExp; label: string; options?: Record<string, string> }[] = [
  { tile: /^Reports/, label: "Reports" },
  { tile: /^Mind map/, label: "Mind map" },
  { tile: /^Infographic/, label: "Infographic" },
  { tile: /^Slides/, label: "Slides" },
  { tile: /^Quiz/, label: "Quiz" },
  { tile: /^Flashcards/, label: "Flashcards" },
  { tile: /^Audio summary/, label: "Audio summary" },
  { tile: /^Podcast/, label: "Podcast", options: { Length: "5" } },
  { tile: /^Video summary/, label: "Video summary" },
];

let page: Page;
let lesson = "";
let course = "";
let w: Awaited<ReturnType<typeof watch>>;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await browser.newPage({ locale: "en-US", acceptDownloads: true });
  // The provider, Hugging Face for the voices, nothing else.
  w = await watch(page, { allowHosts: /(^|\.)(anthropic\.com|openai\.com|googleapis\.com|mistral\.ai|groq\.com|openrouter\.ai|x\.ai|huggingface\.co|hf\.co)$/ });
});

test.afterAll(async () => {
  await w.assertClean();
  await page.close();
});

async function download(button: Locator): Promise<{ name: string; bytes: Buffer }> {
  const [d] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const bytes = readFileSync(await d.path());
  expect(bytes.length, d.suggestedFilename()).toBeGreaterThan(0);
  return { name: d.suggestedFilename(), bytes };
}

/** The streamed answer is complete: Stop has given way to Send again. */
async function answered() {
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0, { timeout: 120_000 });
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
}

const exportButton = (name: string) => page.getByRole("group", { name: "Export" }).getByRole("button", { name, exact: true });

async function open(label: string) {
  await page.goto(`${siteURL}#/l/${lesson}/studio`);
  await page.getByRole("link", { name: new RegExp(`${label} · `) }).click();
  await expect(page.getByRole("group", { name: "Export" })).toBeVisible();
}

test("the provider answers", async () => {
  await page.goto(`${siteURL}#/settings/ai`);
  await page.getByRole("button", { name: "Online provider" }).click();
  await page.getByLabel("Provider").selectOption(provider);
  await page.getByLabel("API key").fill(key ?? "");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await page.getByRole("button", { name: "Test" }).click();
  await expect(page.getByText("The connection works.")).toBeVisible({ timeout: 60_000 });
});

test("a French course with a note", async () => {
  await page.goto(`${siteURL}#/courses`);
  await page.getByRole("button", { name: "New course" }).click();
  const sheet = page.getByRole("dialog");
  // The title field has the focus as the sheet opens.
  await page.keyboard.type("Thermodynamique");
  await expect(sheet.getByLabel("Title")).toHaveValue("Thermodynamique");
  await sheet.getByLabel("Language of the material").selectOption("fr");
  await sheet.getByRole("button", { name: "Create" }).click();
  course = /#\/c\/([^/]+)/.exec(page.url())?.[1] ?? "";
  await page.getByRole("button", { name: "New lesson" }).click();
  await page.getByRole("button", { name: "Write a note" }).click();
  const note = page.getByRole("dialog");
  await note.getByLabel("Title").fill("Premier principe");
  await note.getByLabel("Text (Markdown)").fill(NOTE);
  await note.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("link", { name: /Premier principe/ })).toBeVisible();
  lesson = /#\/l\/([^/]+)/.exec(page.url())?.[1] ?? "";
  expect(course && lesson).toBeTruthy();
});

test("every Studio kind is made from the note", async () => {
  test.setTimeout(600_000);
  await page.goto(`${siteURL}#/l/${lesson}/studio`);
  for (const k of KINDS) {
    await page.getByRole("button", { name: k.tile }).click();
    const sheet = page.getByRole("dialog");
    for (const [label, value] of Object.entries(k.options ?? {})) await sheet.getByLabel(label).selectOption(value);
    await sheet.getByRole("button", { name: "Generate" }).click();
    await expect(sheet).toBeHidden();
  }
  // Every job ends (no Cancel left), and none of them failed.
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0, { timeout: 540_000 });
  for (const k of KINDS) await expect(page.getByRole("link", { name: new RegExp(`${k.label} · `) })).toBeVisible();
  await expect(page.locator(".notice.error, [role=alert]")).toHaveCount(0);
});

test("the report is cited and exported", async () => {
  await open("Reports");
  const cite = page.locator("button.cite").first();
  await expect(cite).toBeVisible();
  const md = await download(exportButton("Markdown"));
  expect(md.bytes.toString()).toMatch(/\[S1[^\]]*\]/);
  await cite.click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Premier principe" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
});

test("the mind map and the infographic export as images", async () => {
  for (const label of ["Mind map", "Infographic"]) {
    await open(label);
    const svg = await download(exportButton("SVG image"));
    expect(svg.bytes.toString()).toContain("<svg");
    const png = await download(exportButton("PNG image"));
    expect(png.bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
});

test("the slides present and export to PowerPoint", async () => {
  await open("Slides");
  const pptx = await download(exportButton("PowerPoint (.pptx)"));
  expect(pptx.bytes.includes("ppt/presentation.xml")).toBe(true);
  await page.getByRole("button", { name: "Present" }).click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
});

test("the quiz grades a written answer with the model", async () => {
  await open("Quiz");
  await page.getByRole("button", { name: "All at once" }).click();
  await page.getByRole("button", { name: "Start the quiz" }).click();
  const written = page.getByRole("textbox").first();
  if (await written.count()) {
    await written.fill("Le travail est nul car le volume ne change pas, donc ΔU = Q.");
    await written.press("Control+Enter");
    await expect(page.getByText(/^(Correct|Partly right|Not quite)$/).first()).toBeVisible({ timeout: 60_000 });
  }
  await page.getByRole("button", { name: "Finish and see the score" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Score:" })).toBeVisible();
});

test("the flashcards export to Anki and Cursus", async () => {
  await open("Flashcards");
  const apkg = await download(exportButton("Anki (.apkg)"));
  expect(apkg.bytes.includes("collection.anki2")).toBe(true);
  const tsv = await download(exportButton("Anki (text)"));
  expect(tsv.bytes.toString()).toMatch(/^#separator:tab/);
  const cursus = await download(exportButton("Cursus"));
  expect(cursus.bytes.includes("course.json")).toBe(true);
});

test("the audio summary speaks with a voice of this device", async () => {
  await open("Audio summary");
  await expect(page.getByLabel("Audio", { exact: true })).toBeVisible({ timeout: 240_000 });
  const audio = await download(exportButton("Audio file"));
  expect(audio.bytes.length).toBeGreaterThan(50_000);
  const vtt = await download(exportButton("Subtitles (VTT)"));
  expect(vtt.bytes.toString()).toMatch(/^WEBVTT/);
});

test("the podcast script is synthesized with two voices", async () => {
  await open("Podcast");
  await page.getByRole("button", { name: "Synthesize", exact: true }).click();
  await expect(page.getByLabel("Audio", { exact: true })).toBeVisible({ timeout: 240_000 });
  await expect(page.getByRole("navigation", { name: "Chapters" })).toBeVisible();
  const audio = await download(exportButton("Audio file"));
  expect(audio.bytes.length).toBeGreaterThan(100_000);
});

test("the video summary renders to a video file", async () => {
  test.setTimeout(420_000);
  await open("Video summary");
  await exportButton("Video file").click();
  await expect(page.getByText("Render the video first.")).toBeVisible();
  await page.getByRole("button", { name: "Render the video" }).click();
  // The export error goes away with the next click.
  await expect(page.getByText("Render the video first.")).toBeHidden();
  await expect(page.locator("video")).toBeVisible({ timeout: 360_000 });
  const video = await download(exportButton("Video file"));
  expect(video.bytes.subarray(4, 8).toString()).toBe("ftyp");
});

test("the chat answers with citations, then the exchange is summarised", async () => {
  await page.goto(`${siteURL}#/l/${lesson}/chat`);
  await page.getByRole("button", { name: "Ask about these sources" }).click();
  await expect(page.getByText("Passages of 1 source go to")).toBeVisible();
  await page.getByLabel("Your question").fill("Pourquoi Q = -W dans une transformation isotherme ?");
  await page.getByRole("button", { name: "Send" }).click();
  await answered();
  await expect(page.locator(".message.assistant button.cite").first()).toBeVisible();
  await page.getByRole("button", { name: "Summarise the exchange" }).click();
  await expect(page.getByText("Summary of the exchange")).toBeVisible({ timeout: 90_000 });
  await page.goto(`${siteURL}#/l/${lesson}`);
  await expect(page.getByRole("link", { name: /Résumé d'échange/ })).toBeVisible();
});

test("concepts are found and worked on with the tutor", async () => {
  await page.goto(`${siteURL}#/c/${course}/progress`);
  await page.getByRole("button", { name: "Find the concepts in the sources" }).click();
  const tutor = page.getByRole("button", { name: "Work on it with the tutor" }).first();
  await expect(tutor).toBeVisible({ timeout: 120_000 });
  await tutor.click();
  await expect(page.locator(".message.assistant").first()).toBeVisible({ timeout: 90_000 });
  await page.getByLabel("Your question").fill("Une fonction d'état ne dépend que de l'état, pas du chemin : c'est le cas de U.");
  await page.getByRole("button", { name: "Send" }).click();
  await answered();
  await expect(page.locator(".message.assistant")).toHaveCount(2);
  await page.getByRole("button", { name: "End the session" }).click();
  await expect(page.getByText(/Session ended\. Understanding: \d+ %\./)).toBeVisible({ timeout: 90_000 });
});

test("Discover maps a new topic with the provider's web search", async () => {
  await page.goto(`${siteURL}#/discover`);
  await page.getByLabel("Topic").fill("Photosynthesis");
  await page.getByRole("button", { name: "Map the topic" }).click();
  await page.getByRole("button", { name: "Create the topic" }).click({ timeout: 240_000 });
  await expect(page.getByRole("tab", { name: /Sources/ })).toBeVisible();
  await expect(page.getByRole("listitem").first()).toBeVisible();
});
