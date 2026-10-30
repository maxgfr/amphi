// Structured answers: the model is asked for JSON only, the answer is cut out
// of whatever wraps it (code fences, a sentence before), validated with zod,
// and asked again once with the validation error when it does not fit.

import { z } from "zod";
import { tr } from "../i18n.ts";
import { AiError, ask, type AskOptions } from "./llm.ts";

/** The first complete JSON value (object or array) in a text, or null. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Short, readable zod issues for the model to fix. */
export function issuesOf(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

export interface AskJsonOptions extends Omit<AskOptions, "messages"> {
  prompt: string;
  /** The shape to answer with, shown to the model (a TypeScript-like sketch or an example). */
  shape: string;
}

export async function askJson<S extends z.ZodType>(schema: S, o: AskJsonOptions): Promise<z.infer<S>> {
  const system = `${o.system}\n\nAnswer with JSON only, no prose and no code fence, of this shape:\n${o.shape}`;
  let prompt = o.prompt;
  let previous = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text } = await ask({ ...o, system, messages: previous ? [{ role: "user", content: o.prompt }, { role: "assistant", content: previous }, { role: "user", content: prompt }] : undefined, prompt });
    const value = extractJson(text);
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    previous = text.slice(0, 20_000);
    prompt = value === null ? "That was not valid JSON. Answer again with the JSON only." : `That JSON does not fit the shape: ${issuesOf(parsed.error)}. Answer again with the corrected JSON only.`;
  }
  throw new AiError(tr("The model's answer did not have the expected form; try again or pick another model.", "La réponse du modèle n'avait pas la forme attendue ; réessayez ou changez de modèle.", "Die Antwort des Modells hatte nicht die erwartete Form; versuchen Sie es erneut oder wählen Sie ein anderes Modell."), "bad-json", true);
}
