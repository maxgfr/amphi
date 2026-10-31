import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { courseWithNote, fixture, MOCK_AI, mockAi, setUpAi, siteURL, watch } from "./helpers.ts";

test.use({ locale: "en-US" });

const PODCAST = {
  title: "Entropy, explained",
  hosts: ["Léa", "Tom"],
  sections: [
    {
      title: "Opening",
      turns: [
        { host: 1, text: "Welcome! Today we talk about entropy [S1 §1]." },
        { host: 2, text: "What does it measure?" },
      ],
    },
    { title: "The second law", turns: [{ host: 1, text: "It never decreases." }] },
  ],
};

/** The provider's speech endpoint, answering every line with a short WAV; returns the texts it read. */
async function mockSpeech(page: Page) {
  const wav = await readFile(fixture("speech.wav"));
  const read: { input: string; voice: string; model: string }[] = [];
  await page.route(`${MOCK_AI}/audio/speech`, async (route) => {
    read.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, headers: { "content-type": "audio/wav" }, body: wav });
  });
  return read;
}

/** English read by the provider's voice model (the mocked server) instead of the voices on this device. */
async function providerVoices(page: Page) {
  await page.goto(`${siteURL}#/settings/voice`);
  await page.getByRole("group", { name: "Voices for English" }).getByRole("button", { name: "Provider's voice" }).click();
  await expect(page.getByText("Read by 127.0.0.1:9 (tts-1), which receives the script.")).toBeVisible();
}

async function download(page: Page, name: string) {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name }).click()]);
  return { name: file.suggestedFilename(), text: await readFile(await file.path(), "utf8") };
}

test("a podcast: the script is reviewed and edited, then read by two voices, played and exported", async ({ page }) => {
  const w = await watch(page);
  await mockAi(page, (c) => (c.system.includes("podcast") ? JSON.stringify(PODCAST) : "ok"));
  const read = await mockSpeech(page);
  await setUpAi(page);
  await providerVoices(page);
  await courseWithNote(page);

  await page.getByRole("tab", { name: "Studio" }).click();
  await page.getByRole("button", { name: /^Podcast/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Tone").selectOption("debate");
  await sheet.getByLabel("Length").selectOption("5");
  await expect(sheet.getByText("The script is shown to you before any voice reads it.")).toBeVisible();
  await sheet.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("link", { name: /Entropy, explained/ }).click();

  // Ready with a script and no audio yet: nothing was read.
  await expect(page.getByText("Read the script through and change what you like, then synthesize it.")).toBeVisible();
  await expect(page.getByText("The script is read by 127.0.0.1:9's voice model, which receives its text.")).toBeVisible();
  await expect(page.getByLabel("Line by Léa").first()).toHaveValue("Welcome! Today we talk about entropy.");
  expect(read).toEqual([]);
  await page.getByLabel("Line by Tom").fill("And what does entropy measure, exactly?");
  await page.getByRole("button", { name: "Synthesize", exact: true }).click();

  const player = page.getByLabel("Audio", { exact: true });
  await expect(player).toBeVisible();
  expect(read.map((r) => r.input)).toEqual(["Welcome! Today we talk about entropy.", "And what does entropy measure, exactly?", "It never decreases."]);
  // Two hosts, two voices.
  expect(new Set(read.map((r) => r.voice)).size).toBe(2);
  const text = page.getByRole("list", { name: "Text" });
  await expect(text.getByText("And what does entropy measure, exactly?")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /The second law/ })).toBeVisible();

  await text.getByRole("button", { name: /^Play from/ }).nth(1).click();
  await expect.poll(() => player.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0.6);
  await expect(text.locator('li[aria-current="true"]')).toBeVisible();

  const audio = await download(page, "Audio file");
  expect(audio.name).toMatch(/^entropy-explained\.(webm|m4a|wav)$/);
  const vtt = await download(page, "Subtitles (VTT)");
  expect(vtt.text).toMatch(/^WEBVTT\n/);
  expect(vtt.text).toContain("<v Tom>And what does entropy measure, exactly?");
  const md = await download(page, "Script (Markdown)");
  expect(md.text).toContain("## The second law");
  expect(md.text).toContain("**Tom:** And what does entropy measure, exactly?");

  // Editing the script again makes the audio out of date until it is synthesized again.
  await page.getByRole("button", { name: "Edit the script" }).click();
  await page.getByLabel("Line by Léa").last().fill("It never decreases in an isolated system.");
  await page.getByLabel("Line by Léa").last().blur();
  await expect(page.getByText("The script changed since the audio was made.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Synthesize again" })).toBeVisible();
  await w.assertClean();
});

test("an audio summary is written for the ear, read, and its text follows the voice", async ({ page }) => {
  const w = await watch(page);
  await mockAi(page, (c) => (c.system.includes("spoken summary") ? JSON.stringify({ title: "Entropy in two minutes", paragraphs: ["Entropy measures disorder [S1 §1].", "It never decreases in an isolated system."] }) : "ok"));
  const read = await mockSpeech(page);
  await setUpAi(page);
  await providerVoices(page);
  await courseWithNote(page);

  await page.getByRole("tab", { name: "Studio" }).click();
  await page.getByRole("button", { name: /^Audio summary/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("The script is read by 127.0.0.1:9's voice model, which receives its text.")).toBeVisible();
  await sheet.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("link", { name: /Entropy in two minutes/ }).click();

  await expect(page.getByLabel("Audio", { exact: true })).toBeVisible();
  expect(read.map((r) => r.input)).toEqual(["Entropy measures disorder.", "It never decreases in an isolated system."]);
  await expect(page.getByRole("list", { name: "Text" }).getByText("It never decreases in an isolated system.")).toBeVisible();
  const vtt = await download(page, "Subtitles (VTT)");
  expect(vtt.text).toContain("00:00:00.000 --> ");
  const md = await download(page, "Transcript (Markdown)");
  expect(md.text).toBe("# Entropy in two minutes\n\nEntropy measures disorder.\n\nIt never decreases in an isolated system.\n");
  await w.assertClean();
});

test("the voices settings show what each language downloads before anything is fetched", async ({ page }) => {
  const w = await watch(page);
  await page.goto(`${siteURL}#/settings/voice`);
  const en = page.getByRole("group", { name: "English", exact: true });
  await expect(en.getByText(/To download once: 9\d(\.\d)? MB/)).toBeVisible();
  await expect(page.getByRole("group", { name: "French", exact: true }).getByText(/To download once: 7\d(\.\d)? MB/)).toBeVisible();
  // Two German voices are two models; the same voice twice is one.
  const de = page.getByRole("group", { name: "German", exact: true });
  await expect(de.getByText(/To download once: 12\d(\.\d)? MB/)).toBeVisible();
  await de.getByLabel("Second host").selectOption("piper:de_DE-kerstin-low");
  await expect(de.getByText(/To download once: 63(\.\d)? MB/)).toBeVisible();
  await w.assertClean();
});

test("the voice settings link to the licences the site ships under, with eSpeak NG's GPL", async ({ page }) => {
  await page.goto(`${siteURL}#/settings/voice`);
  const link = page.getByRole("link", { name: "Licences and source code" });
  const notice = await page.request.get(new URL((await link.getAttribute("href"))!, siteURL).href);
  expect(await notice.text()).toContain("distributed under GPL-3.0-or-later");
  const gpl = await page.request.get(`${siteURL}licenses/GPL-3.0.txt`);
  expect(await gpl.text()).toContain("GNU GENERAL PUBLIC LICENSE");
});
