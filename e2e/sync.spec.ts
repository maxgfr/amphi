import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { FakeGitHub } from "../src/sync/fake-github.ts";
import { courseWithNote, siteURL, watch } from "./helpers.ts";

// Two browser contexts are two devices; both talk to one in-memory GitHub,
// answered through page routes, so nothing leaves the machine.
const GITHUB = "https://api.github.com";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, accept, x-github-api-version",
  "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE",
  "access-control-expose-headers": "*",
};

async function device(ctx: BrowserContext, fake: FakeGitHub) {
  await ctx.route(`${GITHUB}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const res = await fake.handle(new Request(req.url(), { method: req.method(), headers: await req.allHeaders(), body: req.method() === "GET" ? undefined : (req.postDataBuffer() as Uint8Array<ArrayBuffer> | null) }));
    return route.fulfill({ status: res.status, headers: { ...Object.fromEntries(res.headers), ...CORS }, body: Buffer.from(await res.arrayBuffer()) });
  });
  const page = await ctx.newPage();
  return { page, watched: await watch(page, { allow: [GITHUB] }) };
}

async function fillRepo(page: Page, fake: FakeGitHub) {
  await page.goto(`${siteURL}#/settings/sync`);
  await page.getByLabel(/^Repository/).fill(`https://github.com/${fake.owner}/${fake.repo}`);
  await page.getByLabel(/^Token/).fill(fake.token);
  await page.getByRole("button", { name: "Check" }).click();
}

const synced = (page: Page) => expect(page.getByRole("status")).toContainText("Synced", { timeout: 30_000 });

test("a course made on one device reaches another through a GitHub repository, and back", async ({ browser }) => {
  const fake = new FakeGitHub({ empty: true });
  const a = await device(await browser.newContext(), fake);
  await courseWithNote(a.page);
  await fillRepo(a.page, fake);
  await expect(a.page.getByText("amphi has not written here yet")).toBeVisible();
  await expect(a.page.getByRole("button", { name: "Readable files" })).toHaveAttribute("aria-pressed", "true");
  await a.page.getByRole("button", { name: "Connect and sync" }).click();
  await synced(a.page);
  const files = [...fake.files().keys()];
  expect(files).toContain("amphi/amphi.json");
  const note = files.find((p) => p.endsWith("/text.md"));
  expect(note).toMatch(/^amphi\/courses\/thermodynamics-[0-9a-f]{8}\/lessons\/[^/]+\/sources\/entropy-[0-9a-f]{8}\/text\.md$/);
  expect(fake.text(note ?? "")).toContain("Entropy measures disorder.");
  // The shell shows how sync stands.
  await expect(a.page.locator(".sync-badge")).toHaveAttribute("data-state", "ok");

  const b = await device(await browser.newContext(), fake);
  await fillRepo(b.page, fake);
  await expect(b.page.getByText("already holds amphi data, in readable files")).toBeVisible();
  await b.page.getByRole("button", { name: "Connect and sync" }).click();
  await synced(b.page);
  await b.page.goto(`${siteURL}#/courses`);
  await expect(b.page.getByText("Thermodynamics")).toBeVisible();

  // B adds a course; A gets it.
  await b.page.getByRole("button", { name: "New course" }).click();
  await b.page.getByRole("dialog").getByLabel("Title").fill("Optics");
  await b.page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(b.page.getByRole("heading", { name: "Optics" })).toBeVisible();
  await b.page.goto(`${siteURL}#/settings/sync`);
  await expect(b.page.getByRole("status")).toContainText("1 change waiting");
  await b.page.getByRole("button", { name: "Sync now" }).click();
  await expect(b.page.getByRole("status")).not.toContainText("waiting");
  await a.page.goto(`${siteURL}#/settings/sync`);
  await a.page.getByRole("button", { name: "Sync now" }).click();
  await synced(a.page);
  await a.page.goto(`${siteURL}#/courses`);
  await expect(a.page.getByText("Optics")).toBeVisible();

  await a.watched.assertClean();
  await b.watched.assertClean();
});

test("end-to-end encrypted: the repository holds opaque objects; another device needs the passphrase", async ({ browser }) => {
  const fake = new FakeGitHub();
  const pass = "correct horse battery staple";
  const a = await device(await browser.newContext(), fake);
  await courseWithNote(a.page);
  await fillRepo(a.page, fake);
  await a.page.getByRole("button", { name: "End-to-end encrypted" }).click();
  await a.page.getByLabel(/^Passphrase(?! again)/).fill(pass);
  await a.page.getByLabel("Passphrase again").fill(pass);
  await a.page.getByRole("button", { name: "Connect and sync" }).click();
  await synced(a.page);
  await expect(a.page.getByText("End-to-end encrypted", { exact: true })).toBeVisible();
  const files = [...fake.files()];
  expect(files.filter(([p]) => p.startsWith("amphi/")).every(([p]) => p === "amphi/amphi.json" || /^amphi\/objects\/[0-9a-f]{64}$/.test(p))).toBe(true);
  for (const [, bytes] of files) expect(Buffer.from(bytes).toString()).not.toContain("Thermodynamics");
  expect(JSON.parse(fake.text("amphi/amphi.json") ?? "")).toMatchObject({ mode: "encrypted", kdf: { iterations: 600000 } });

  const b = await device(await browser.newContext(), fake);
  await fillRepo(b.page, fake);
  await expect(b.page.getByText("end-to-end encrypted. Type its passphrase")).toBeVisible();
  await b.page.getByLabel(/^Passphrase(?! again)/).fill("not the passphrase");
  await b.page.getByRole("button", { name: "Connect and sync" }).click();
  await expect(b.page.getByText("This passphrase does not open this repository.")).toBeVisible();
  await b.page.getByLabel(/^Passphrase(?! again)/).fill(pass);
  await b.page.getByRole("button", { name: "Connect and sync" }).click();
  await synced(b.page);
  await b.page.goto(`${siteURL}#/courses`);
  await expect(b.page.getByText("Thermodynamics")).toBeVisible();

  await a.watched.assertClean();
  await b.watched.assertClean();
});

test("a zip backup opens in a fresh browser", async ({ browser }) => {
  const a = await browser.newContext();
  const pa = await a.newPage();
  const wa = await watch(pa);
  await courseWithNote(pa);
  await pa.goto(`${siteURL}#/settings/sync`);
  const download = pa.waitForEvent("download");
  await pa.getByRole("button", { name: "Export a zip" }).click();
  const zip = await (await download).path();
  expect((await download).suggestedFilename()).toMatch(/^amphi-\d{4}-\d{2}-\d{2}\.zip$/);

  const c = await browser.newContext();
  const pc = await c.newPage();
  const wc = await watch(pc);
  await pc.goto(`${siteURL}#/settings/sync`);
  await pc.getByLabel("Zip to import").setInputFiles(zip);
  await expect(pc.getByText(/^Imported: \d+ record/)).toBeVisible();
  await pc.goto(`${siteURL}#/courses`);
  await pc.getByText("Thermodynamics").click();
  await expect(pc.getByRole("tab", { name: "Sources 1" })).toBeVisible();

  await wa.assertClean();
  await wc.assertClean();
});
