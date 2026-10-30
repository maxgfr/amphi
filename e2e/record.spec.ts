import { expect, type Page, test } from "@playwright/test";
import { MOCK_AI, mockAi, setUpAi, siteURL, watch } from "./helpers.ts";

// Chromium's fake microphone (a beep) and no permission prompt.
test.use({ locale: "en-US", launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

async function newCourse(page: Page, title = "Thermodynamics") {
  await page.goto(`${siteURL}#/courses`);
  await page.getByRole("button", { name: "New course" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

const timer = (page: Page) => page.getByRole("timer", { name: "Recorded time" });

test("a lecture is recorded with a marker, then transcribed by the provider and read along", async ({ page }) => {
  const w = await watch(page);
  await mockAi(page, () => "");
  const uploads: { type: string; size: number }[] = [];
  await page.route(`${MOCK_AI}/audio/transcriptions`, async (route) => {
    const body = route.request().postDataBuffer() ?? Buffer.alloc(0);
    const type = /Content-Type: (audio\/[\w-]+)/.exec(body.toString("latin1"))?.[1] ?? "";
    uploads.push({ type, size: body.length });
    await route.fulfill({
      json: {
        task: "transcribe",
        language: "english",
        duration: 4,
        text: "Entropy measures disorder. It never decreases.",
        segments: [
          { id: 0, seek: 0, start: 0, end: 2, text: " Entropy measures disorder.", tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 1, no_speech_prob: 0 },
          { id: 1, seek: 0, start: 2, end: 4, text: " It never decreases.", tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 1, no_speech_prob: 0 },
        ],
      },
    });
  });
  await setUpAi(page);
  await newCourse(page);

  await page.getByRole("link", { name: "Record a lecture" }).click();
  await expect(page.getByRole("heading", { name: "Record a lecture" })).toBeVisible();
  await expect(page.getByLabel("Lesson")).toHaveValue("new");
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recording" })).toBeVisible();
  await expect(timer(page)).toHaveText("0:02", { timeout: 10_000 });
  await page.getByRole("button", { name: "Important" }).click();
  await expect(page.getByRole("list", { name: "Marked moments" }).getByText("0:02")).toBeVisible();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Paused" })).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(timer(page)).toHaveText("0:04", { timeout: 10_000 });
  await page.getByRole("button", { name: "Stop and save" }).click();

  // The source, in a new lesson dated today, waiting for transcription.
  await expect(page.getByRole("heading", { name: /Recording of/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Lesson 1" })).toBeVisible();
  await expect(page.locator(".meta").first()).toContainText(/0:0[4-5] · .* · waiting for transcription/);
  await expect(page.getByLabel("Marked moments")).toContainText("0:02");

  // The provider, announced before anything is sent.
  await page.getByLabel("Engine").selectOption("cloud");
  await expect(page.getByLabel("Transcription model")).toBeVisible();
  await page.getByLabel("Transcription model").fill("whisper-1");
  await expect(page.getByText(/is sent to 127\.0\.0\.1:9 and transcribed by whisper-1/)).toBeVisible();
  expect(uploads).toEqual([]);
  await page.getByRole("button", { name: "Send and transcribe" }).click();

  await expect(page.getByText("It never decreases.")).toBeVisible();
  expect(uploads).toHaveLength(1);
  expect(uploads[0]!.type).toMatch(/^audio\/(webm|mp4)$/);
  await expect(page.getByRole("button", { name: "Send and transcribe" })).toHaveCount(0);

  // A line of the transcript plays the recording from its time.
  await page.getByRole("listitem").filter({ hasText: "It never decreases." }).getByRole("button", { name: "0:02" }).click();
  await expect.poll(() => page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThanOrEqual(2);

  // The engine choice is remembered.
  expect(await page.evaluate(() => localStorage.getItem("amphi-stt-engine"))).toBe("cloud");
  await w.assertClean();
});

test("a recording cut short by a closed tab is recovered from what reached the disk", async ({ page }) => {
  const w = await watch(page);
  await newCourse(page, "Law");
  await page.getByRole("link", { name: "Record a lecture" }).click();
  await page.getByRole("button", { name: "Start recording" }).click();
  // The first chunk reaches IndexedDB after ten seconds.
  await expect(timer(page)).toHaveText("0:11", { timeout: 20_000 });
  await page.reload();

  await expect(page.getByText(/was interrupted \(about 0:1\d saved\)/)).toBeVisible();
  await page.getByRole("button", { name: "Recover the recording" }).click();
  await expect(page.getByRole("heading", { name: /Recording of/ })).toBeVisible();
  await expect(page.locator(".meta").first()).toContainText(/0:1\d · .* · waiting for transcription/);
  await expect(page.getByLabel("Engine")).toBeVisible();
  // Nothing left to recover.
  await page.goBack();
  await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recover the recording" })).toHaveCount(0);
  await w.assertClean();
});
