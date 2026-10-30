import { expect, test } from "bun:test";
import { defaultLanguage, engineProblem, engineSize, isEngineId, resolveEngine } from "./engines.ts";

test("auto picks Parakeet to detect, Canary when told a language it knows, Whisper beyond", () => {
  expect(resolveEngine("auto", "auto")).toEqual({ kind: "nemo", model: "parakeet" });
  expect(resolveEngine("auto", "fr")).toEqual({ kind: "nemo", model: "canary" });
  expect(resolveEngine("auto", "it")).toEqual({ kind: "nemo", model: "parakeet" });
  expect(resolveEngine("auto", "ja")).toEqual({ kind: "whisper", preset: "balanced" });
  expect(resolveEngine("whisper-fast", "fr")).toEqual({ kind: "whisper", preset: "fast" });
  expect(resolveEngine("canary", "de")).toEqual({ kind: "nemo", model: "canary" });
  expect(resolveEngine("cloud", "auto")).toEqual({ kind: "cloud" });
});

test("sizes, language problems and the course's language", () => {
  expect(engineSize({ kind: "nemo", model: "parakeet" })).toBeGreaterThan(600);
  expect(engineSize({ kind: "cloud" })).toBe(0);
  expect(engineProblem({ kind: "nemo", model: "canary" }, "it")).toBe("canary-language");
  expect(engineProblem({ kind: "nemo", model: "canary" }, "fr")).toBeNull();
  expect(engineProblem({ kind: "whisper", preset: "fast" }, "auto")).toBe("whisper-auto");
  expect(defaultLanguage("fr-FR")).toBe("fr");
  expect(defaultLanguage("ja")).toBe("auto");
  expect(defaultLanguage(undefined)).toBe("auto");
  expect(isEngineId("whisper-fast")).toBe(true);
  expect(isEngineId("nope")).toBe(false);
});
