// eSpeak NG turns the text of the voices on this device into phonemes. Its
// wasm build (@diffusionstudio/piper-wasm, rhasspy's piper-phonemize) comes
// with the data of every language, 18 MB, most of it Russian and Chinese
// dictionaries. The build keeps the files the voices read (phoneme tables,
// intonations, languages) and only the English, French and German
// dictionaries, about 1.4 MB, and rewrites the file list Emscripten's loader
// carries to match. eSpeak NG and its data are GPL-3.0-or-later.

const LOADER = /loadPackage\((\{"files":\[[\s\S]*?\],"remote_package_size":\d+\})\)/;

interface PackageFile {
  filename: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

const DICTS = new Set(["en_dict", "fr_dict", "de_dict"]);

/** Whether a file of eSpeak NG's data is kept: everything but the other languages' dictionaries and the voice variants. */
export const keepEspeakFile = (name: string) => {
  const base = name.split("/").pop() ?? "";
  if (base.endsWith("_dict")) return DICTS.has(base);
  return !name.includes("/voices/!v/");
};

/** The loader script and its data package with only the kept files. */
export function trimEspeak(glue: string, data: Uint8Array, keep: (name: string) => boolean = keepEspeakFile): { glue: string; data: Uint8Array } {
  const m = LOADER.exec(glue);
  if (!m) throw new Error("piper_phonemize.js: Emscripten's package list was not found");
  const meta = JSON.parse(m[1]!) as { files: PackageFile[]; remote_package_size: number };
  if (meta.remote_package_size !== data.byteLength) throw new Error("piper_phonemize.data does not match its loader");
  const files: PackageFile[] = [];
  const parts: Uint8Array[] = [];
  let at = 0;
  for (const f of meta.files) {
    if (!keep(f.filename)) continue;
    const bytes = data.subarray(f.start, f.end);
    files.push({ ...f, start: at, end: at + bytes.byteLength });
    parts.push(bytes);
    at += bytes.byteLength;
  }
  const out = new Uint8Array(at);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  const next = JSON.stringify({ ...meta, files, remote_package_size: at });
  return { glue: glue.replace(m[0], () => `loadPackage(${next})`), data: out };
}
