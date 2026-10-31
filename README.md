# amphi

Follow your courses with AI, in your browser. Record or import your lectures (PDF, notes, audio, video), then get summaries, study guides, mind maps, quizzes, flashcards for Anki and [Cursus](https://github.com/maxgfr/cursus), slides, infographics, podcasts and video summaries, all grounded in your own sources and cited down to the page or the minute. Discover a new topic with your AI provider's web search, and see what to work on next.

**https://maxgfr.github.io/amphi/**

- **No server, no account.** Everything lives in your browser (IndexedDB). Sync is your own GitHub repository (readable Markdown and JSON, or end-to-end encrypted) or a folder on your computer.
- **Your own AI.** Bring a key for OpenAI, Anthropic, Google, Mistral, Groq, OpenRouter or xAI, or run a model locally (Ollama, LM Studio), through [llm-connect](https://github.com/maxgfr/llm-models/tree/main/packages/llm-connect). Keys are encrypted on the device, optionally behind a passphrase.
- **Speech on the device.** Lectures are transcribed in the page (NVIDIA Parakeet, Canary or Whisper); voices for podcasts can run in the page too. Your provider's models are an explicit option.
- **Strict by default.** A Content-Security-Policy with Trusted Types, no third-party script, and a build gate that fails if the bundle could reach an unlisted origin.

Interface in English, French and German.

## Develop

```bash
bun install
bun run dev        # http://localhost:4173/amphi/
bun run typecheck && bun run lint && bun test src scripts
bun run build && bun run check:network
bun run e2e
AMPHI_LIVE_KEY=… bun run e2e:live   # the whole path against a real provider, never in CI
```

## License

amphi's source code is under the [MIT licence](LICENSE).

The published site also ships [eSpeak NG](https://github.com/rhasspy/espeak-ng), compiled to WebAssembly, which the voices of the device use to turn text into phonemes. eSpeak NG is under the GPL, version 3 or later, so the site taken as a whole is distributed under GPL-3.0-or-later. [public/licenses/NOTICE.txt](public/licenses/NOTICE.txt) lists what is shipped, where its source is and the licences of the other parts. The site serves that file and the [GPL text](public/licenses/GPL-3.0.txt) under `licenses/`.
