// The user's own AI provider, through llm-connect: the catalog is the static
// ./models.json, the key sits in the vault (src/secrets.ts), and nothing is
// sent until the user saves a provider and asks for something. Every feature
// calls the model through `ask` or `askStream`.

import "./zod-jitless.ts";
import { generateText, type ModelMessage, streamText, type ToolSet } from "ai";
import {
  callProblem,
  type Capabilities,
  createLlmSettingsStore,
  describeError,
  isConfigured,
  type LlmSettings,
  loadModel,
  modelIdOf,
  providerKindOf,
  resolveCapabilities,
  vaultStorage,
} from "llm-connect";
import { currentLang, languageName, tr } from "../i18n.ts";
import { loadVault, vault } from "../secrets.ts";

export const llm = createLlmSettingsStore({
  catalog: "./models.json",
  storage: vaultStorage({ vault, prefsKey: "amphi-ai" }),
  recommended: ["anthropic", "openai", "google", "mistral", "groq", "openrouter"],
  defaults: { rememberKey: true },
});

let loaded: Promise<unknown> | null = null;
export const loadLlm = () => (loaded ??= loadVault().then(() => llm.load()).catch(() => null));
/** After the vault unlocks or changes: read the settings again. */
export const reloadLlm = () => {
  loaded = null;
  return loadLlm();
};

export function savedSettings(): LlmSettings | null {
  const s = llm.getState().saved;
  return s && isConfigured(s) ? (s as LlmSettings) : null;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export function settings(): LlmSettings {
  const s = savedSettings();
  if (!s) throw new AiError(tr("Set up an AI provider first (Settings → AI).", "Configurez d'abord un fournisseur d'IA (Réglages → IA).", "Richten Sie zuerst einen KI-Anbieter ein (Einstellungen → KI)."), "no-provider");
  return s;
}

/** Who receives what is sent, for the notice shown before sending: "Anthropic", "localhost:11434". */
export function recipient(s: LlmSettings | null = savedSettings()): string {
  if (!s) return "";
  if (s.customEndpoint) {
    try {
      return new URL(s.customEndpoint).host;
    } catch {
      return s.customEndpoint;
    }
  }
  return s.providerName ?? s.providerId ?? "";
}

export function capabilities(s: LlmSettings = settings()): Capabilities {
  return resolveCapabilities({ kind: providerKindOf(s), modelId: modelIdOf(s) });
}

/** The language answers are written in: the course's, else the interface's, as an English name for prompts. */
export const writeIn = (language?: string) => languageName(language || currentLang());

export interface AskOptions {
  /** The system prompt (AI SDK 7 takes it as `instructions`). */
  system: string;
  prompt?: string;
  messages?: ModelMessage[];
  tools?: ToolSet;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

function prepare(o: AskOptions) {
  const s = settings();
  const messages: ModelMessage[] = o.messages ?? [{ role: "user", content: o.prompt ?? "" }];
  const problem = callProblem(s, { messages, tools: o.tools }, capabilities(s));
  if (problem) throw new AiError(problem.message, problem.code);
  return { s, messages };
}

function wrap(e: unknown, s: LlmSettings): never {
  if (e instanceof AiError || (e as Error)?.name === "AbortError") throw e;
  // A model on this machine answers without a network, so being offline is only blamed once a call failed.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new AiError(
      tr("You are offline, so your AI provider cannot be reached. Your courses and what was already made still work; try again once connected.", "Vous êtes hors ligne : votre fournisseur d'IA est injoignable. Vos cours et ce qui a déjà été fait restent disponibles ; réessayez une fois connecté.", "Sie sind offline, Ihr KI-Anbieter ist daher nicht erreichbar. Ihre Kurse und alles bereits Erstellte funktionieren weiter; versuchen Sie es mit Verbindung erneut."),
      "offline",
      true,
    );
  }
  const d = describeError(e, s.apiKey);
  throw new AiError(d.message, d.code, d.retryable);
}

/** Room for a reasoning model's thinking, which counts against the output cap, on top of an answer's own budget. */
export const THINKING_ROOM = 16_000;

/** The output cap to send for an answer of `answer` tokens: thinking room for a model that reasons, within the model's own cap. */
export function outputCap(answer: number | undefined, caps: Pick<Capabilities, "reasoning" | "maxOutput">): number | undefined {
  if (!answer) return undefined;
  const want = caps.reasoning ? answer + THINKING_ROOM : answer;
  return caps.maxOutput > 0 ? Math.min(want, caps.maxOutput) : want;
}

export interface AskResult {
  text: string;
  /** The answer stopped at the output cap, so it is likely incomplete. */
  truncated?: boolean;
  /** Sources the provider's web search returned, when tools included it. */
  sources: { url: string; title?: string }[];
}

export async function ask(o: AskOptions): Promise<AskResult> {
  await loadLlm();
  const { s, messages } = prepare(o);
  try {
    const res = await generateText({
      model: await loadModel(s),
      instructions: o.system,
      messages,
      tools: o.tools,
      maxOutputTokens: outputCap(o.maxOutputTokens, capabilities(s)),
      maxRetries: 1,
      abortSignal: o.signal,
    });
    const sources = (res.sources ?? []).flatMap((x) => (x.sourceType === "url" ? [{ url: x.url, title: x.title }] : []));
    return { text: res.text, sources, truncated: res.finishReason === "length" };
  } catch (e) {
    wrap(e, s);
  }
}

/** Text as it arrives, for the chat. */
export async function* askStream(o: AskOptions): AsyncGenerator<string> {
  await loadLlm();
  const { s, messages } = prepare(o);
  let failure: unknown = null;
  const res = streamText({
    model: await loadModel(s),
    instructions: o.system,
    messages,
    maxOutputTokens: outputCap(o.maxOutputTokens, capabilities(s)),
    maxRetries: 1,
    abortSignal: o.signal,
    onError: ({ error }) => {
      failure = error;
    },
  });
  try {
    for await (const part of res.textStream) yield part;
  } catch (e) {
    wrap(e, s);
  }
  if (failure) wrap(failure, s);
}
