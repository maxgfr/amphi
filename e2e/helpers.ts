import { expect, type Page, type Route } from "@playwright/test";

export const siteURL = process.env.AMPHI_URL ?? "http://localhost:4173/amphi/";
const siteOrigin = new URL(siteURL).origin;
/** The fake OpenAI-compatible server the tests point the AI settings at; requests to it are answered by `mockAi`. */
export const MOCK_AI = "http://127.0.0.1:9/v1";

export const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname;

/** Records every request leaving the page's origin (but the mocked AI), every CSP violation and every page error. */
export async function watch(page: Page) {
  const external: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (![siteOrigin, "null", new URL(MOCK_AI).origin].includes(u.origin) && !["blob:", "data:"].includes(u.protocol)) external.push(r.url());
  });
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return {
    async assertClean() {
      expect(external, "requests to other origins").toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp), "CSP violations").toEqual([]);
      expect(errors, "page errors").toEqual([]);
    },
  };
}

export interface AiCall {
  system: string;
  last: string;
  stream: boolean;
}

/** Answers the app's chat completions with `reply(call)`, streamed when asked. Returns the calls seen. */
export async function mockAi(page: Page, reply: (call: AiCall) => string) {
  const calls: AiCall[] = [];
  await page.route(`${MOCK_AI}/**`, async (route: Route) => {
    const url = route.request().url();
    if (url.endsWith("/models")) return route.fulfill({ json: { object: "list", data: [{ id: "mock", object: "model" }] } });
    const body = route.request().postDataJSON() as { messages: { role: string; content: string | { text?: string }[] }[]; stream?: boolean };
    const text = (c: string | { text?: string }[]) => (typeof c === "string" ? c : c.map((p) => p.text ?? "").join(""));
    const call: AiCall = {
      system: body.messages.filter((m) => m.role === "system").map((m) => text(m.content)).join("\n"),
      last: text(body.messages.at(-1)?.content ?? ""),
      stream: Boolean(body.stream),
    };
    calls.push(call);
    const content = reply(call);
    if (!call.stream) {
      return route.fulfill({
        json: { id: "x", object: "chat.completion", created: 0, model: "mock", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      });
    }
    const chunk = (delta: object, finish: string | null) => `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "mock", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const words = content.split(/(?<= )/);
    const sse = words.map((w) => chunk({ content: w }, null)).join("") + chunk({}, "stop") + "data: [DONE]\n\n";
    return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sse });
  });
  return calls;
}

/** Point the AI settings at the mocked server. */
export async function setUpAi(page: Page) {
  await page.goto(`${siteURL}#/settings/ai`);
  await page.getByRole("button", { name: "On my machine" }).click();
  await page.getByLabel("Server address").fill(MOCK_AI);
  await page.getByLabel("Model", { exact: true }).fill("mock");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
}

/** A course with one lesson and one note; returns to the lesson's page. */
export async function courseWithNote(page: Page, note = "Entropy measures disorder. The second law says it never decreases in an isolated system.") {
  await page.goto(`${siteURL}#/courses`);
  await page.getByRole("button", { name: "New course" }).click();
  const course = page.getByRole("dialog");
  await course.getByLabel("Title").fill("Thermodynamics");
  await course.getByRole("button", { name: "Create" }).click();
  await page.getByRole("button", { name: "New lesson" }).click();
  await page.getByRole("button", { name: "Write a note" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Title").fill("Entropy");
  await sheet.getByLabel("Text (Markdown)").fill(note);
  await sheet.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("link", { name: /Entropy/ })).toBeVisible();
}
