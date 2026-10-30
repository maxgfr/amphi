# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A university student (bachelor or master), often studying in French, German or English, sometimes in two of them in the same term. They follow lectures, collect the material (slides, PDFs, notes, recordings) by course and lesson, and need to understand it and be ready for the exam. The same person across three devices and moments:

- iPad during lectures, often with a keyboard: recording, a quick note, a source open beside the lecturer;
- phone on the move, often offline (metro, lecture-hall Wi-Fi): listening to an audio summary or podcast, a quiz or a few flashcards;
- laptop in the evening for longer sessions: importing, generating study material, chatting with the sources.

They are short on time and under exam pressure.

## Product Purpose

amphi turns a student's own lectures into material to understand and revise: transcripts, summaries and study guides, mind maps, quizzes, flashcards, infographics, slide decks, audio summaries, podcasts and video summaries, plus a chat that answers from the sources. Everything is grounded in the student's sources and cited down to the page or the minute. Discover maps a new topic; Progress tracks the concepts of a course and says what to work on next. Success: after a lecture the student records or imports it, gets what they need from it in a few taps, and trusts every claim because they can open the passage it comes from.

## Positioning

No server, no account: the courses live in the browser (IndexedDB) and sync to the student's own GitHub repository, a folder or a zip. The AI is the student's own provider and key (or a local model), called straight from the page; speech can be transcribed and voices synthesised on the device. Comparable tools (NotebookLM and similar) own the account and the data; amphi does not.

## Operating Context

- Courses are the organising unit, each with lessons and sources; a course may have its own language and an exam date. A "topic" is a course started from Discover.
- Daily ritual: open Today, follow the one next step (transcribe, summarise, review a shaky concept), then the course.
- Before anything leaves the device the UI says what goes where (the provider's name, the voice service).
- Sibling app: Cursus (spaced-repetition review). amphi exports flashcards and whole courses to it, and to Anki.
- Static site on GitHub Pages (`maxgfr.github.io/amphi/`), installable as a PWA.

## Capabilities and Constraints

- Local-first PWA: after a first visit the shell, every screen and the app's own code work offline. AI generation, Discover, cloud voices and GitHub sync need the network and must say so; speech and voice models are downloaded once into the libraries' own caches.
- Interface languages: English, French, German (German strings run long). Generated material follows the course's language.
- Strict CSP with Trusted Types; no third-party script, no external font; each external origin is allowlisted with its reason.
- Bun build, React 19, TypeScript strict, plain CSS with custom-property tokens.

## Brand Commitments

- Name: amphi (lower case), after the lecture hall.
- Voice: calm, plain, precise. Says what happens and what is sent, never hypes the AI.
- Standing preference of the user for study apps (shared with Cursus): "une application clean, pour pouvoir focus". Things 3 is the quality bar for calm and finish. No noisy gamification: no confetti, no streak pressure, no badges.

## Evidence on Hand

None: no users, testimonials or metrics. Do not fabricate any.

## Product Principles

1. Trust first: every generated claim cites the student's source, and every state the UI shows (saved, synced, offline, sent to whom) is true.
2. Grounded in the student's own sources: amphi works from what the student brings, not from the open web, unless they ask (Discover).
3. One clear next action: each screen makes the next useful step obvious, and Today names exactly one.
4. Calm under pressure: the interface lowers stress; no urgency it did not need, no decoration competing with the course.
5. The student owns everything: open formats, exports, their own repository and key.

## Accessibility & Inclusion

- WCAG 2.2 AA. Full keyboard use (iPad keyboard, laptop), visible focus, touch targets of 44px on touch screens.
- Trilingual interface with long German strings: nothing has a fixed text width.
- Respects reduced motion and the system's light or dark appearance (with a manual override).
