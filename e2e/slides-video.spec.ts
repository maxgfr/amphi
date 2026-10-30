import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { courseWithNote, fixture, MOCK_AI, mockAi, setUpAi, siteURL, watch } from "./helpers.ts";

test.use({ locale: "en-US" });

const SLIDES = {
  title: "Entropy in slides",
  slides: [
    { layout: "title", title: "Entropy", subtitle: "Disorder and the second law", notes: "Welcome everyone.", cites: ["S1 §1"] },
    { layout: "bullets", title: "What it measures", bullets: ["Disorder [S1 §1]", "It never decreases"], notes: "Say it slowly.", cites: ["S1 §1"] },
    { layout: "diagram", title: "The process", diagram: { kind: "steps", items: [{ label: "Heat", detail: "Energy comes in" }, { label: "Spread", detail: "Disorder grows" }, { label: "Balance" }] }, notes: "Three steps." },
    { layout: "key-figure", title: "Never", figure: { value: "0", label: "decrease in an isolated system" }, notes: "The law itself." },
  ],
};

const STORYBOARD = {
  title: "Entropy, the video",
  scenes: [
    { visual: "title", title: "Entropy", subtitle: "In one minute", narration: "Today, entropy in one minute [S1 §1].", cites: ["S1 §1"] },
    { visual: "bullets", title: "What it measures", bullets: ["Disorder", "Never decreases"], narration: "Entropy measures disorder." },
    { visual: "diagram", title: "The process", diagram: { kind: "cycle", items: [{ label: "Heat" }, { label: "Spread" }, { label: "Balance" }] }, narration: "It never decreases in an isolated system." },
  ],
};

async function download(page: Page, name: string) {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name, exact: true }).click()]);
  const bytes = await readFile(await file.path());
  expect(bytes.length, file.suggestedFilename()).toBeGreaterThan(0);
  return { name: file.suggestedFilename(), bytes, text: bytes.toString("utf8") };
}

async function openStudio(page: Page, tile: RegExp) {
  await page.getByRole("tab", { name: "Studio" }).click();
  await page.getByRole("button", { name: tile }).click();
  return page.getByRole("dialog");
}

test("a slide deck is edited, presented with the keyboard and exported to PowerPoint and PDF", async ({ page }) => {
  const w = await watch(page);
  await page.addInitScript(() => {
    (window as unknown as { __printed: number }).__printed = 0;
    window.print = () => {
      (window as unknown as { __printed: number }).__printed++;
    };
  });
  const calls = await mockAi(page, (c) => (c.system.includes("slide deck") ? JSON.stringify(SLIDES) : "ok"));
  await setUpAi(page);
  await courseWithNote(page);

  const sheet = await openStudio(page, /^Slides/);
  await sheet.getByLabel("Number of slides").selectOption("6");
  await sheet.getByLabel("Audience").selectOption("review");
  await sheet.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("link", { name: /Entropy in slides/ }).click();
  expect(calls.find((c) => c.system.includes("slide deck"))?.system).toContain("about 6 slides");

  const strip = page.getByRole("list", { name: "Slides" });
  await expect(strip.getByRole("button")).toHaveCount(4);
  // The labels left the text for the slide's sources, which open the passage.
  await strip.getByRole("button", { name: "Slide 2: What it measures" }).click();
  await expect(page.getByLabel("Bullets (one a line)")).toHaveValue("Disorder\nIt never decreases");

  // Edit a slide: its thumbnail follows.
  await page.getByLabel("Slide title").fill("What entropy measures");
  await page.getByLabel("Slide title").blur();
  await expect(strip.getByRole("button", { name: "Slide 2: What entropy measures" })).toBeVisible();
  await page.getByLabel("Speaker notes").fill("Slowly, with an example.");
  await page.getByLabel("Speaker notes").blur();

  // Reorder, add and delete.
  await page.getByRole("button", { name: "Move down" }).click();
  await expect(strip.getByRole("button").nth(2)).toHaveAccessibleName("Slide 3: What entropy measures");
  await page.getByRole("button", { name: "Add a slide" }).click();
  await expect(strip.getByRole("button")).toHaveCount(5);
  await expect(page.getByLabel("Slide title")).toHaveValue("New slide");
  await page.getByRole("button", { name: "Delete the slide" }).click();
  await expect(strip.getByRole("button")).toHaveCount(4);

  // Present from the current slide; the keyboard moves through the deck, N shows the notes, Escape leaves.
  await strip.getByRole("button", { name: "Slide 3: What entropy measures" }).click();
  await page.getByRole("button", { name: "Present" }).click();
  const show = page.getByRole("dialog", { name: "Presentation" });
  await expect(show).toBeVisible();
  await expect(show.getByText("Slide 3 of 4")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(show.getByText("Slide 4 of 4")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(show.getByText("Slide 4 of 4")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(show.getByText("Slide 1 of 4")).toBeVisible();
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  await page.keyboard.press("n");
  await expect(show.getByRole("region", { name: "Speaker notes" })).toHaveText("Slowly, with an example.");
  await expect(show.getByRole("group", { name: "What entropy measures" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(show).toBeHidden();
  await expect(page.getByRole("button", { name: "Present" })).toBeFocused();

  // PowerPoint: a zip with the four slides in their new order, their text and notes.
  const pptx = await download(page, "PowerPoint (.pptx)");
  expect(pptx.name).toBe("entropy-in-slides.pptx");
  expect([...pptx.bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  const zip = unzipSync(new Uint8Array(pptx.bytes));
  expect(Object.keys(zip).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(4);
  expect(strFromU8(zip["ppt/slides/slide3.xml"]!)).toContain("What entropy measures");
  expect(strFromU8(zip["ppt/slides/slide2.xml"]!)).toContain("Energy comes in");
  expect(strFromU8(zip["ppt/notesSlides/notesSlide3.xml"]!)).toContain("Slowly, with an example.");

  // PDF: the print dialog, with one slide a landscape page.
  await page.getByRole("button", { name: "PDF (print)" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  expect(pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)).toHaveLength(4);

  const md = await download(page, "Outline and notes (Markdown)");
  expect(md.text).toContain("## 3. What entropy measures");

  // Edits are kept.
  await page.reload();
  await expect(page.getByRole("list", { name: "Slides" }).getByRole("button", { name: "Slide 3: What entropy measures" })).toBeVisible();
  await w.assertClean();
});

/** The provider's speech endpoint, answering every line with a short WAV; returns the texts it read. */
async function mockSpeech(page: Page) {
  const wav = await readFile(fixture("speech.wav"));
  const read: { input: string }[] = [];
  await page.route(`${MOCK_AI}/audio/speech`, async (route) => {
    read.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, headers: { "content-type": "audio/wav" }, body: wav });
  });
  return read;
}

test("a video summary: the storyboard is reviewed and edited, then narrated, drawn, encoded and exported", async ({ page }) => {
  const w = await watch(page);
  await mockAi(page, (c) => (c.system.includes("storyboard") ? JSON.stringify(STORYBOARD) : "ok"));
  const read = await mockSpeech(page);
  await setUpAi(page);
  await page.goto(`${siteURL}#/settings/voice`);
  await page.getByRole("group", { name: "Voices for English" }).getByRole("button", { name: "Provider's voice" }).click();
  await courseWithNote(page);

  const sheet = await openStudio(page, /^Video summary/);
  await expect(sheet.getByText("The storyboard is shown to you before anything is rendered. The script is read by 127.0.0.1:9's voice model, which receives its text.", { exact: false })).toBeVisible();
  await sheet.getByLabel("Length").selectOption("short");
  await sheet.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("link", { name: /Entropy, the video/ }).click();

  // A storyboard, nothing read yet.
  await expect(page.getByText("Read the storyboard through and change what you like, then render the video.")).toBeVisible();
  await expect(page.getByLabel("Narration of scene 1")).toHaveValue("Today, entropy in one minute.");
  expect(read).toEqual([]);
  await page.getByLabel("Narration of scene 2").fill("Entropy measures how disordered a system is.");
  await page.getByLabel("Narration of scene 2").blur();

  // Exporting before rendering says why; the message goes with the next click.
  await page.getByRole("group", { name: "Export" }).getByRole("button", { name: "Video file" }).click();
  await expect(page.getByText("Render the video first.")).toBeVisible();
  await page.getByRole("button", { name: "Render the video" }).click();
  await expect(page.getByText("Render the video first.")).toBeHidden();
  const player = page.getByLabel("Video", { exact: true });
  await expect(player).toBeVisible({ timeout: 90_000 });
  expect(read.map((r) => r.input)).toEqual(["Today, entropy in one minute.", "Entropy measures how disordered a system is.", "It never decreases in an isolated system."]);
  await expect.poll(() => player.evaluate((v: HTMLVideoElement) => (Number.isFinite(v.duration) ? v.duration : 0))).toBeGreaterThan(1);
  expect(await player.evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight])).toEqual([1280, 720]);
  expect(await player.evaluate((v: HTMLVideoElement) => v.textTracks.length)).toBe(1);
  // It plays, and the scene being shown is marked.
  const scenes = page.getByRole("list", { name: "Scenes" });
  await scenes.getByRole("button", { name: /^Play from/ }).nth(1).click();
  await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2);
  await expect(scenes.locator('li[aria-current="true"]')).toBeVisible();

  const file = await download(page, "Video file");
  expect(file.name).toMatch(/^entropy-the-video\.(mp4|webm)$/);
  expect(file.bytes.length).toBeGreaterThan(2000);
  if (file.name.endsWith(".mp4")) expect(file.bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");
  else expect([...file.bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  const vtt = await download(page, "Subtitles (VTT)");
  expect(vtt.text).toMatch(/^WEBVTT\n/);
  expect(vtt.text).toContain("Entropy measures how disordered a system is.");
  const md = await download(page, "Storyboard (Markdown)");
  expect(md.text).toContain("## 2. What it measures (0:");
  expect(md.text).toContain("> Entropy measures how disordered a system is.");

  // Editing the storyboard makes the video out of date until it is rendered again.
  await page.getByRole("button", { name: "Edit the storyboard" }).click();
  await page.getByLabel("Narration of scene 3").fill("It never goes down.");
  await page.getByLabel("Narration of scene 3").blur();
  await expect(page.getByText("The storyboard changed since the video was made.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Render again" })).toBeVisible();
  await w.assertClean();
});

test("without a video encoder the summary plays as a live narrated slideshow and says why", async ({ page }) => {
  const w = await watch(page);
  await page.addInitScript(() => {
    delete (window as unknown as { VideoEncoder?: unknown }).VideoEncoder;
  });
  await mockAi(page, (c) => (c.system.includes("storyboard") ? JSON.stringify(STORYBOARD) : "ok"));
  await mockSpeech(page);
  await setUpAi(page);
  await page.goto(`${siteURL}#/settings/voice`);
  await page.getByRole("group", { name: "Voices for English" }).getByRole("button", { name: "Provider's voice" }).click();
  await courseWithNote(page);
  const sheet = await openStudio(page, /^Video summary/);
  await sheet.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("link", { name: /Entropy, the video/ }).click();
  await page.getByRole("button", { name: "Render the video" }).click();

  const narration = page.getByLabel("Narration", { exact: true });
  await expect(narration).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/This browser cannot encode video/)).toBeVisible();
  await expect(page.getByRole("group", { name: "Entropy" })).toBeVisible();
  // Seeking to the third scene shows it.
  await page.getByRole("list", { name: "Scenes" }).getByRole("button", { name: /^Play from/ }).nth(2).click();
  await expect(page.getByRole("group", { name: "The process" })).toBeVisible();
  await page.getByRole("button", { name: "Video file", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("This browser cannot encode video");
  const vtt = await download(page, "Subtitles (VTT)");
  expect(vtt.text).toContain("It never decreases in an isolated system.");
  await w.assertClean();
});
