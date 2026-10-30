import { expect, type Page, test } from "@playwright/test";
import { FakeGitHub } from "../src/sync/fake-github.ts";
import { courseWithNote, mockAi, setUpAi, siteURL, watch } from "./helpers.ts";

// After a first visit the service worker holds the app: the shell at install,
// then the rest of the app's own code. Offline, every screen and the Studio's
// views and exports keep working; what needs the network says so.
test.use({ locale: "en-US", launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

const GITHUB = "https://api.github.com";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, accept, x-github-api-version",
  "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE",
  "access-control-expose-headers": "*",
};

const QUIZ = { questions: [{ kind: "mcq", question: "What does entropy measure?", choices: ["Disorder", "Mass", "Speed", "Charge"], answer: 0, explanation: "Entropy measures disorder [S1 §1].", concept: "Entropy", cite: "S1 §1" }] };
const MINDMAP = { title: "Thermodynamics", children: [{ title: "Entropy", cite: "S1 §1", children: [{ title: "Disorder" }] }, { title: "Second law", children: [] }] };
const CARDS = { cards: [{ kind: "basic", front: "What does entropy measure?", back: "Disorder.", concept: "entropy", source: "S1 §1" }] };
const SLIDES = { title: "Entropy in slides", slides: [{ layout: "title", title: "Entropy", subtitle: "Disorder", notes: "Hello.", cites: ["S1 §1"] }, { layout: "bullets", title: "What it measures", bullets: ["Disorder [S1 §1]"], notes: "Slowly." }] };

function reply(c: { system: string }): string {
  if (c.system.includes("write a quiz")) return JSON.stringify(QUIZ);
  if (c.system.includes("mind map")) return JSON.stringify(MINDMAP);
  if (c.system.includes("You write flashcards")) return JSON.stringify(CARDS);
  if (c.system.includes("slide deck")) return JSON.stringify(SLIDES);
  return "## Key ideas\nEntropy measures disorder [S1 §1].";
}

async function make(page: Page, tile: RegExp, link: RegExp): Promise<string> {
  await page.getByRole("tab", { name: "Studio" }).click();
  await page.getByRole("button", { name: tile }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Generate" }).click();
  await page.getByRole("link", { name: link }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toBeVisible();
  const url = page.url();
  await page.goBack();
  return url;
}

async function download(page: Page, name: string) {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name, exact: true }).click()]);
  expect(file.suggestedFilename()).toBeTruthy();
}

test("after a first visit, every screen, the Studio's views and its exports work offline; AI and sync say they need the network", async ({ context, page }) => {
  const fake = new FakeGitHub({ empty: true });
  await context.route(`${GITHUB}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const res = await fake.handle(new Request(req.url(), { method: req.method(), headers: await req.allHeaders(), body: req.method() === "GET" ? undefined : (req.postDataBuffer() as Uint8Array<ArrayBuffer> | null) }));
    return route.fulfill({ status: res.status, headers: { ...Object.fromEntries(res.headers), ...CORS }, body: Buffer.from(await res.arrayBuffer()) });
  });
  const w = await watch(page, { allow: [GITHUB] });
  await mockAi(page, reply);
  await setUpAi(page);
  await courseWithNote(page);
  const lesson = page.url();
  const report = await make(page, /^Reports/, /Summary · Lesson 1/);
  const quiz = await make(page, /^Quiz/, /Quiz · Lesson 1/);
  const mindmap = await make(page, /^Mind map/, /Mind map ·/);
  const cards = await make(page, /^Flashcards/, /Flashcards · Lesson 1/);
  const slides = await make(page, /^Slides/, /Entropy in slides/);
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Thermodynamics" }).click();
  const course = page.url();

  // Sync to a repository while online.
  await page.goto(`${siteURL}#/settings/sync`);
  await page.getByLabel(/^Repository/).fill(`https://github.com/${fake.owner}/${fake.repo}`);
  await page.getByLabel(/^Token/).fill(fake.token);
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: "Connect and sync" }).click();
  await expect(page.getByRole("status")).toContainText("Synced", { timeout: 30_000 });

  // The whole app is on the device once Settings says so.
  await page.goto(`${siteURL}#/settings/device`);
  await expect(page.getByText(/^Yes: the app is on this device/)).toBeVisible({ timeout: 60_000 });

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  // Every screen.
  const screens: [string, RegExp | string][] = [
    [`${siteURL}#/`, "Today"],
    [`${siteURL}#/courses`, "Courses"],
    [`${siteURL}#/discover`, "Discover a topic"],
    [course, "Thermodynamics"],
    [`${course}/sources`, "Thermodynamics"],
    [`${course}/progress`, "Thermodynamics"],
    [lesson, "Lesson 1"],
    [`${siteURL}#/record/${course.split("#/c/")[1]}`, "Record a lecture"],
  ];
  for (const [url, heading] of screens) {
    await page.goto(url);
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
  }
  for (const tab of ["AI", "Voices", "Sync", "Keys", "This device", "Privacy"]) {
    await page.goto(`${siteURL}#/settings`);
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel").locator("[aria-busy=true]")).toHaveCount(0);
  }
  await page.goto(`${course}/studio`);
  await expect(page.getByRole("button", { name: /^Podcast/ })).toBeVisible();
  await page.goto(`${course}/chat`);
  await expect(page.getByRole("button", { name: "Ask about these sources" })).toBeVisible();

  // Recording needs no network.
  await page.goto(`${siteURL}#/record/${course.split("#/c/")[1]}`);
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recording" })).toBeVisible();
  await page.getByRole("button", { name: "Stop and save" }).click();
  await expect(page.getByRole("heading", { name: /Recording of/ })).toBeVisible();

  // The Studio's views and exports.
  await page.goto(report);
  await expect(page.getByText("Entropy measures disorder")).toBeVisible();
  await download(page, "Markdown");
  await page.goto(quiz);
  await page.getByRole("button", { name: "Start the quiz" }).click();
  await expect(page.getByText("What does entropy measure?")).toBeVisible();
  await page.goto(mindmap);
  await expect(page.getByRole("tree").or(page.locator(".mm-canvas")).first()).toBeVisible();
  await page.goto(cards);
  await expect(page.getByRole("list", { name: "Cards" }).getByText("What does entropy measure?")).toBeVisible();
  await download(page, "Anki (.apkg)");
  await page.goto(slides);
  await expect(page.getByRole("list", { name: "Slides" }).getByRole("button")).toHaveCount(2);
  await download(page, "PowerPoint (.pptx)");

  // What needs the network says so instead of breaking.
  await page.getByRole("button", { name: "Regenerate" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Generate" }).click();
  await expect(page.getByRole("alert").or(page.locator(".notice.error")).first()).toContainText("You are offline", { timeout: 30_000 });
  await page.goto(`${course}/chat`);
  await page.getByRole("button", { name: "Ask about these sources" }).click();
  await page.getByLabel("Your question").fill("Can entropy decrease?");
  await page.getByLabel("Your question").press("Enter");
  await expect(page.getByText(/You are offline/)).toBeVisible({ timeout: 30_000 });
  await page.goto(`${siteURL}#/settings/sync`);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("GitHub could not be reached, or was busy. Sync will try again.")).toBeVisible({ timeout: 30_000 });

  await context.setOffline(false);
  await w.assertClean();
});
