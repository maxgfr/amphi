# amphi: working notes

A local-first study app on GitHub Pages (`maxgfr.github.io/amphi/`): no server, no account. Bun build (no framework bundler), React 19, TypeScript strict, plain CSS, oxlint, Playwright. AI through llm-connect with the user's own key.

## Commands

- `bun run dev`: build and serve under `/amphi/` on port 4173.
- `bun run typecheck`, `bun run lint`, `bun test src scripts`, `bun run build`, `bun run check:network`, `bun run e2e`: the CI gates, all must pass.
- `bun run catalog`: refresh `public/models.json`.

## Conventions

- Interface strings sit where they are shown, as `t("English", "Français", "Deutsch")` (`src/i18n.ts`); prompts are written in English and say which language to write in (`writeIn`).
- Data: `src/data/schema.ts` (types) and `src/data/db.ts` (IndexedDB). Deletions are tombstones (`remove`), files go to the blob store (`putBlob`). Screens read through `useLive`.
- AI: `ask` / `askStream` (`src/ai/llm.ts`), JSON answers through `askJson` with a zod schema (`src/ai/structured.ts`), sources through `buildContext` and `CITE_RULE` (`src/ai/context.ts`). Before sending, the UI says what goes where (`recipient()`).
- Studio artifacts: one module per type implementing `StudioKind` (`src/studio/types.ts`), listed once in `src/studio/registry.ts`. Heavy libraries load with `import()` inside `generate` or an export.
- Security: strict CSP and Trusted Types in `index.html`. Workers and script URLs go through `scriptURL` (`src/trusted.ts`); HTML reaches the DOM only through DOMPurify (`src/ui/markdown.tsx`); no inline styles in markup (React's style prop is fine). A new external origin needs the CSP and an entry with its reason in `scripts/check-no-network.ts`.
- `useEffect` bodies are blocks: a returned value (even a promise from `scrollIntoView`) is taken for a cleanup.
- Comments explain why, briefly. Match the surrounding code.

## Git

Conventional commits, signed. No mention of AI tools in commits, PRs or code. `.impeccable/` is never committed.
