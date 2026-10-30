// Fail the build if the shipped site could reach another origin: any
// external URL in a bundle is an error unless allowlisted below with a
// reason, and network APIs pointed at a literal external URL are always an
// error. Same gate as maxgfr/verbatim.
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const dist = process.argv[2] ?? "dist";


// The speech worker's lazy transformers.js chunk (Whisper).
const TRANSFORMERS = /^assets\/w-[\w-]*transformers[\w.-]*\.js$/;

// pdf.js, loaded only to read an imported PDF's text.
const PDFJS = /^assets\/pdf-[\w.-]*\.js$/;

// pptxgenjs (with JSZip), loaded only to export a slide deck.
const PPTX = /^assets\/pptxgen[\w.-]*\.js$/;

// Hosts that may appear as inert strings, each with the reason it is safe,
// and the files they may appear in when that is narrower than every file.
const ALLOWED_HOSTS: [string, string, RegExp?][] = [
  ["react.dev", "React's minified-error decoder URL inside thrown Error messages"],
  ["www.w3.org", "SVG/XHTML namespace URIs, never dereferenced"],
  ["maxgfr.github.io", "the site's own canonical address in a <link rel=canonical>"],
  ["github.com", "the 'Source' links and the token creation link: anchors the user chooses to follow, not requests"],
  ["api.github.com", "the user's own data repository, called only after the user connects it in Sync settings; index.html's connect-src allows it"],
  ["json-schema.org", "JSON Schema identifiers inside the AI SDK, never requested"],
  // The user's own AI provider: called only after the user saves a provider on the AI page and asks for
  // something; index.html's connect-src lists exactly these, and models.json carries their base URLs.
  ["api.openai.com", "OpenAI API, only with the user's saved key"],
  ["api.anthropic.com", "Anthropic API, only with the user's saved key"],
  ["generativelanguage.googleapis.com", "Google Gemini API, only with the user's saved key"],
  ["api.mistral.ai", "Mistral API, only with the user's saved key"],
  ["openrouter.ai", "OpenRouter API, only with the user's saved key"],
  ["api.groq.com", "Groq API, only with the user's saved key"],
  ["api.x.ai", "xAI API, only with the user's saved key"],
  ["ai-gateway.vercel.sh", "the AI SDK's default gateway, never selected (llm-connect builds provider-specific models) and blocked by the CSP"],
  ["ai-sdk.dev", "documentation links in AI SDK error messages, never requested"],
  ["vercel.com", "documentation links in AI SDK error messages, never requested"],
  ["ai.google.dev", "documentation links in the Google provider's error messages, never requested"],
  ["docs.cloud.google.com", "documentation links in the Google provider's error messages, never requested"],
  ["google.aip.dev", "documentation links in the Google provider's error messages, never requested"],
  // On-device AI.
  [
    "huggingface.co",
    "where the speech models (Parakeet, Canary, Whisper) and the voices (Kokoro, Piper, pinned revisions checked by SHA-256) are downloaded from, once, after the user sees their size; the CSP's connect-src allows huggingface.co and its download servers for that",
  ],
  ["llm-connect.invalid", "a placeholder base URL llm-connect builds transcription requests against before swapping in the provider's; .invalid never resolves"],
  ["mozilla.org", "documentation links inside error messages, never requested"],
  ["www.webmproject.org", "the VP9 codec-string spec cited in a Mediabunny error message, never requested"],
  ["aomediacodec.github.io", "the AV1 codec-string spec cited in a Mediabunny error message, never requested"],
  ["web.dev", "documentation link inside an ONNX Runtime error message, never requested"],
  ["cdn.jsdelivr.net", "the default location of ONNX Runtime's wasm in transformers.js and onnxruntime-web; worker.ts points both at the site's own ort/, and the CSP would block this host"],
  ["developer.mozilla.org", "documentation links inside error messages, never requested"],
  ["example.com", "a dummy base pdf.js uses to parse relative links inside a PDF, never requested", PDFJS],
  ["foo.bar", "a dummy base pdf.js uses to parse relative links inside a PDF, never requested", PDFJS],
  ["gist.github.com", "a link inside a Transformers.js error message, never requested", TRANSFORMERS],
  ["schemas.openxmlformats.org", "Office Open XML namespace URIs written into an exported .pptx, never dereferenced", PPTX],
  ["schemas.microsoft.com", "Office XML namespace URIs written into an exported .pptx, never dereferenced", PPTX],
  ["purl.org", "Dublin Core namespace URIs in an exported .pptx's properties, never dereferenced", PPTX],
  ["gitbrent.github.io", "documentation links in pptxgenjs's comments and error messages, never requested", PPTX],
  ["stuk.github.io", "JSZip's documentation link in its license header and error messages, never requested", PPTX],
  ["raw.github.com", "JSZip's license link in its header comment, never requested", PPTX],
  ["stuartk.com", "JSZip's author link in its license header, never requested", PPTX],
];

const URL_RE = /\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi;
const FETCH_LITERAL = /\b(?:fetch|import|importScripts|sendBeacon|WebSocket|EventSource)\s*\(\s*["'`](?:https?:)?\/\/[^"'`]+/gi;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const allowed = new Map(ALLOWED_HOSTS.map(([h, , files]) => [h, files]));
const allowedIn = (host: string, rel: string) => allowed.has(host) && (allowed.get(host)?.test(rel) ?? true);
const problems: string[] = [];
let scanned = 0;
for await (const path of walk(dist)) {
  if (!/\.(js|html|css|json|webmanifest|wasm)$/.test(path)) continue;
  scanned++;
  const bytes = await Bun.file(path).arrayBuffer();
  const rel = relative(dist, path);
  if (path.endsWith(".wasm")) {
    // wasm reaches the network only through imported JS functions; strings
    // in its data (such as brotli's dictionary) are inert. Check the imports.
    for (const imp of WebAssembly.Module.imports(new WebAssembly.Module(bytes))) {
      if (/fetch|xmlhttp|websocket|beacon|eventsource|import_?script/i.test(imp.name)) problems.push(`${rel}: imports ${imp.module}.${imp.name}`);
    }
    continue;
  }
  const text = new TextDecoder("latin1").decode(bytes);
  for (const m of text.matchAll(URL_RE)) {
    const host = m[1]!.toLowerCase();
    if (!allowedIn(host, rel)) problems.push(`${rel}: external URL ${m[0]}`);
  }
  for (const m of text.matchAll(FETCH_LITERAL)) problems.push(`${rel}: network call to a literal URL: ${m[0]}`);
}

if (scanned === 0) {
  console.error(`no files scanned in ${dist}; build the site first`);
  process.exit(1);
}
if (problems.length) {
  console.error([...new Set(problems)].join("\n"));
  console.error(`\n${problems.length} problem(s). Allowlist a host only with a reason, in scripts/check-no-network.ts.`);
  process.exit(1);
}
console.log(`no-network check: ${scanned} files clean`);
