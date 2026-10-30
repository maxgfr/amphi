// The voices that run on this device, and the files each one downloads.
//
// Why these engines (measured in October 2026, sizes from the Hugging Face API):
// - English: Kokoro-82M v1.0 (Apache-2.0), the 8-bit ONNX export (92 MB, plus
//   0.5 MB per voice). The most natural small model there is, with many voices
//   in one model, so a dialogue needs no second download. kokoro-js is not
//   used: it pins transformers.js 3 and an older ONNX Runtime, which would ship
//   a second copy of both; the model is run here with ONNX Runtime directly.
// - French and German: Piper (VITS, rhasspy/piper-voices), 63 to 77 MB a
//   voice, about ten times faster than real time on one wasm thread, with
//   clearly better prosody than MMS-TTS (Xenova/mms-tts-fra/deu, 38 MB
//   quantized, one robotic voice per language and CC-BY-NC). fr_FR-upmc
//   carries two speakers (Jessica, Pierre) in one model; German needs two
//   models (Kerstin, Thorsten), both CC0.
// Both read phonemes from eSpeak NG (src/workers/voice.ts).
//
// Files are pinned to a repository revision and checked against their
// SHA-256 after download.

export type DeviceEngine = "kokoro" | "piper";
export type VoiceLang = "en" | "fr" | "de";
export const VOICE_LANGS: readonly VoiceLang[] = ["en", "fr", "de"];

export interface ModelFile {
  url: string;
  bytes: number;
  sha256: string;
}

export interface VoiceModel {
  id: string;
  engine: DeviceEngine;
  /** The weights and configuration every voice of this model needs. */
  files: ModelFile[];
  license: string;
}

export interface DeviceVoice {
  /** "kokoro:af_heart", "piper:fr_FR-upmc-medium:1". */
  id: string;
  lang: VoiceLang;
  name: string;
  gender: "f" | "m";
  model: string;
  /** Files this voice adds to its model's (Kokoro's style vectors). */
  files: ModelFile[];
  /** eSpeak NG voice that phonemizes its text. */
  espeak: string;
  /** Speaker number inside a multi-speaker Piper model. */
  speaker?: number;
}

const KOKORO = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231";
const PIPER = "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd";

const piper = (id: string, path: string, onnx: [number, string], json: [number, string], license: string): VoiceModel => ({
  id,
  engine: "piper",
  files: [
    { url: `${PIPER}/${path}/${id}.onnx`, bytes: onnx[0], sha256: onnx[1] },
    { url: `${PIPER}/${path}/${id}.onnx.json`, bytes: json[0], sha256: json[1] },
  ],
  license,
});

export const MODELS: VoiceModel[] = [
  {
    id: "kokoro",
    engine: "kokoro",
    files: [
      { url: `${KOKORO}/onnx/model_quantized.onnx`, bytes: 92_361_116, sha256: "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478" },
      { url: `${KOKORO}/tokenizer.json`, bytes: 3_497, sha256: "77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34" },
    ],
    license: "Apache-2.0",
  },
  piper("fr_FR-upmc-medium", "fr/fr_FR/upmc/medium", [76_733_615, "9abb3800c199148897a9ed64e100d224f3de83579f100044174ad19418f1786f"], [4_996, "e8636ec15dfd5d72db37a02cb5320a20f2b8d339f2a0e4337da64c58a33a5868"], "CC-BY-SA-4.0"),
  piper("fr_FR-siwis-medium", "fr/fr_FR/siwis/medium", [63_201_294, "641d1ab097da2b81128c076810edb052b385decc8be3381814802a64a73baf99"], [4_875, "39479916c2db192b5ac9764daddd0c744d83e023ad890c6976c0633ae4df8959"], "CC-BY-4.0"),
  piper("de_DE-thorsten-medium", "de/de_DE/thorsten/medium", [63_201_294, "7e64762d8e5118bb578f2eea6207e1a35a8e0c30595010b666f983fc87bb7819"], [4_819, "974adee790533adb273a1ac88f49027d2a1b8f0f2cf4905954a4791e79264e85"], "CC0"),
  piper("de_DE-kerstin-low", "de/de_DE/kerstin/low", [63_104_526, "d352a7641892cebf2903859af94e9ba81a141110215fe3943bcda7f7da401b7a"], [4_158, "56e708556b7b9b7a53c4f8957e021421e69f11a600962bba554cffbe72cf2d47"], "CC0"),
];

const kokoro = (id: string, name: string, gender: "f" | "m", sha256: string): DeviceVoice => ({
  id: `kokoro:${id}`,
  lang: "en",
  name,
  gender,
  model: "kokoro",
  files: [{ url: `${KOKORO}/voices/${id}.bin`, bytes: 522_240, sha256 }],
  // Kokoro's American voices start with "a", its British ones with "b".
  espeak: id.startsWith("b") ? "en" : "en-us",
});

export const VOICES: DeviceVoice[] = [
  kokoro("af_heart", "Heart (US)", "f", "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b"),
  kokoro("am_michael", "Michael (US)", "m", "1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1"),
  kokoro("af_bella", "Bella (US)", "f", "f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b"),
  kokoro("am_fenrir", "Fenrir (US)", "m", "c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43"),
  kokoro("bf_emma", "Emma (UK)", "f", "669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73"),
  kokoro("bm_george", "George (UK)", "m", "c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc"),
  { id: "piper:fr_FR-upmc-medium:0", lang: "fr", name: "Jessica", gender: "f", model: "fr_FR-upmc-medium", files: [], espeak: "fr", speaker: 0 },
  { id: "piper:fr_FR-upmc-medium:1", lang: "fr", name: "Pierre", gender: "m", model: "fr_FR-upmc-medium", files: [], espeak: "fr", speaker: 1 },
  { id: "piper:fr_FR-siwis-medium", lang: "fr", name: "Siwis", gender: "f", model: "fr_FR-siwis-medium", files: [], espeak: "fr" },
  { id: "piper:de_DE-kerstin-low", lang: "de", name: "Kerstin", gender: "f", model: "de_DE-kerstin-low", files: [], espeak: "de" },
  { id: "piper:de_DE-thorsten-medium", lang: "de", name: "Thorsten", gender: "m", model: "de_DE-thorsten-medium", files: [], espeak: "de" },
];

/** The two default voices of each language: a woman and a man, so the hosts of a dialogue sound apart. */
export const DEFAULT_VOICES: Record<VoiceLang, [string, string]> = {
  en: ["kokoro:af_heart", "kokoro:am_michael"],
  fr: ["piper:fr_FR-upmc-medium:0", "piper:fr_FR-upmc-medium:1"],
  de: ["piper:de_DE-kerstin-low", "piper:de_DE-thorsten-medium"],
};

export const voiceById = (id: string): DeviceVoice | undefined => VOICES.find((v) => v.id === id);
export const modelById = (id: string): VoiceModel | undefined => MODELS.find((m) => m.id === id);
export const voicesOf = (lang: VoiceLang): DeviceVoice[] => VOICES.filter((v) => v.lang === lang);

/** A course language ("fr", "fr-CA", "de-AT") as a language the device voices speak, or null. */
export function voiceLangOf(language: string): VoiceLang | null {
  const base = language.toLowerCase().split(/[-_]/)[0] ?? "";
  return (VOICE_LANGS as readonly string[]).includes(base) ? (base as VoiceLang) : null;
}

/** Every file the voices need, each once: their models' and their own. */
export function filesFor(voiceIds: string[]): ModelFile[] {
  const out = new Map<string, ModelFile>();
  for (const id of voiceIds) {
    const v = voiceById(id);
    if (!v) continue;
    for (const f of [...(modelById(v.model)?.files ?? []), ...v.files]) out.set(f.url, f);
  }
  return [...out.values()];
}

export const totalBytes = (files: ModelFile[]) => files.reduce((n, f) => n + f.bytes, 0);
