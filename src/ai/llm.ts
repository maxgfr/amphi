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
  const d = describeError(e, s.apiKey);
  throw new AiError(d.message, d.code, d.retryable);
}

export interface AskResult {
  text: string;
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
      maxOutputTokens: o.maxOutputTokens,
      maxRetries: 1,
      abortSignal: o.signal,
    });
    const sources = (res.sources ?? []).flatMap((x) => (x.sourceType === "url" ? [{ url: x.url, title: x.title }] : []));
    return { text: res.text, sources };
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
    maxOutputTokens: o.maxOutputTokens,
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
