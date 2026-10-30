---
name: amphi
description: A calm study desk for your own lectures, light by day and deep blue-grey by night.
colors:
  ground: "oklch(98.2% 0.004 85)"
  rail: "oklch(96.4% 0.006 85)"
  surface: "oklch(100% 0 0)"
  surface-2: "oklch(96% 0.006 85)"
  line: "oklch(90.5% 0.008 85)"
  line-strong: "oklch(66% 0.01 85)"
  ink: "oklch(23% 0.012 260)"
  ink-muted: "oklch(47% 0.012 260)"
  accent: "oklch(50% 0.13 255)"
  accent-hover: "oklch(45% 0.13 255)"
  accent-ink: "oklch(99% 0 0)"
  accent-soft: "oklch(94.5% 0.028 255)"
  accent-text: "oklch(45% 0.13 255)"
  danger: "oklch(52% 0.17 25)"
  danger-soft: "oklch(95.5% 0.025 25)"
  ok: "oklch(50% 0.12 150)"
  ok-soft: "oklch(95.5% 0.03 150)"
  warn: "oklch(55% 0.12 70)"
  mark: "oklch(93% 0.08 95)"
  dark-ground: "oklch(18.5% 0.008 260)"
  dark-rail: "oklch(20.5% 0.009 260)"
  dark-surface: "oklch(22.5% 0.009 260)"
  dark-surface-2: "oklch(26% 0.01 260)"
  dark-line: "oklch(31% 0.012 260)"
  dark-line-strong: "oklch(52% 0.012 260)"
  dark-ink: "oklch(93% 0.006 85)"
  dark-ink-muted: "oklch(72% 0.01 260)"
  dark-accent: "oklch(72% 0.12 255)"
  dark-accent-ink: "oklch(18% 0.02 260)"
  dark-accent-soft: "oklch(31% 0.05 255)"
  dark-accent-text: "oklch(80% 0.1 255)"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "-0.022em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 650
    lineHeight: 1.3
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  control:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: 1.25
  small:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  footnote:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
  caption:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
  timer:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "3.25rem"
    fontWeight: 400
    fontFeature: "tnum"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  sheet-top: "18px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
  rail: "232px"
  measure: "70ch"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "4px 16px"
    height: "40px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "4px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
  button-small:
    typography: "{typography.small}"
    padding: "4px 12px"
    height: "32px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    size: "40px"
  button-link:
    backgroundColor: "transparent"
    textColor: "{colors.accent-text}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  segmented:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.md}"
    padding: "3px"
  segmented-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  nav-item:
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "38px"
  nav-item-current:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-text}"
  tab:
    textColor: "{colors.ink-muted}"
    typography: "{typography.control}"
    padding: "0 12px"
    height: "44px"
  tab-selected:
    textColor: "{colors.ink}"
  list-group:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  list-row:
    padding: "12px 16px"
    height: "56px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "16px"
  next-step:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.lg}"
    padding: "24px"
  empty-state:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.lg}"
    padding: "48px 24px"
  notice:
    backgroundColor: "{colors.surface-2}"
    typography: "{typography.small}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  notice-error:
    backgroundColor: "{colors.danger-soft}"
  sheet:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    width: "560px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.small}"
    rounded: "{rounded.lg}"
  cite:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.pill}"
    padding: "0 0.45em"
  studio-tile-icon:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.md}"
    size: "36px"
---

# Design System: amphi

## Overview

**The study desk.** amphi is the quiet desk a student comes back to after a lecture: paper-white by day, a deep blue-grey in the evening, one blue that only ever means "here" or "do this". The course is the content and the interface stays out of its way. Things 3 is the bar for calm and finish: native-feeling controls, generous rows, nothing that blinks for attention.

It is an Operate surface everywhere (lists, tabs, forms, sheets, generated material). Familiar patterns are a feature: a sidebar on iPad and laptop, a tab bar on the phone, grouped lists, native `<dialog>` sheets. Ambition shows as precision: one type scale, one radius family, one way to say "selected", one way to say "sent to whom".

Anti-references: gamified study apps (confetti, streak flames, badges), AI products that dress output in gradients and sparkles, dashboards of same-size cards.

## Colors

Restrained: warm neutrals, one accent, semantic hues for state only. Tokens live in `:root` of `src/styles.css`; light and dark share names, so a component never branches on the theme.

- **Ground** (`--bg`) is a barely warm off-white, **Rail** (`--rail-bg`) a shade deeper for the sidebar, **Surface** (`--surface`) pure white for anything the student works in (lists, cards, sheets, inputs).
- **Ink** (`--text`) has a cool cast; **Ink Muted** (`--muted`) carries metadata, hints and inactive tabs. Both pass AA on every surface in both themes.
- **Study Blue** (`--accent`) is for the one primary action, the current place (sidebar row, tab underline, tab-bar item), focus, and progress. **Accent Text** (`--accent-text`) is the darker (light theme) or lighter (dark theme) variant used when blue is text on a surface or on Accent Soft. **Accent Soft** fills the current sidebar row, the Today hero, Studio tile icons, citations and the user's own chat bubbles.
- **Semantic:** `--danger` (delete, recording, wrong answer), `--ok` (correct, level meter, "nothing urgent"), `--warn` (partly right). Each has a `-soft` fill for notices and graded answers.
- **Lines:** `--line` hairlines separate rows and outline groups; `--line-strong` outlines inputs (3:1 against the surface) and hovered buttons.
- **Visualisation** colours (`--viz-b0`..`--viz-b5` and their soft fills) belong to mind maps, infographics and slides only. Slides are always drawn light (`.slide-frame` pins its own palette) because they are presented, printed and exported.
- Dark theme: never pure black; surfaces step up in lightness (ground 18.5%, rail 20.5%, surface 22.5%, surface-2 26%), the accent is lifted to 72% lightness with dark ink on it.

## Typography

The platform's own sans (`ui-sans-serif, system-ui, -apple-system…`): San Francisco on the iPad, iPhone and Mac the students use, Segoe or Roboto elsewhere. A web font was weighed and declined: it would add a download and a CSP entry to buy little over SF on the devices that matter, and the system face handles French and German diacritics everywhere.

A fixed scale, about 1.125, as tokens (`--fs-*`): caption 0.75rem, footnote 0.8125rem, small 0.875rem, control 0.9375rem, body 1rem, lead 1.125rem, title 1.25rem, headline 1.5rem, display 1.875rem (1.625rem on phones). No fluid type in the app.

- Page titles (`h1`) are display, 680, tracking -0.022em; editable titles (lesson, artifact) are headline inside an `h1`.
- Section titles are body 650 with more space above than below; group labels (Studio) are small 650 in Ink Muted.
- Controls are control 500; selected tabs and the current sidebar row go to 600. Avoid 550: Chromium renders it as semibold.
- Prose (reports, notes) keeps a 70ch measure and 1.65 line height.
- Monospace only for measurement: the recording timer and transcript timestamps, with tabular numerals.

## Layout

- **Shell.** From 761px: a 232px sidebar (wordmark, Today, Courses, Discover, Settings, then language, sync and theme at the foot) and the page. Up to 760px: a top bar (wordmark left; language, sync, theme right) and a fixed, translucent tab bar at the bottom (the page is felt scrolling under it; labels 11px 600, ellipsised).
- **Page.** Max 1080px (760px for Settings), padding 32px (16px on phones, plus the tab bar and safe areas at the bottom), 16px between blocks.
- **Head of a page:** breadcrumbs (small, muted), then the title with its actions on the same line; an editable title takes its own line once the actions would crowd it.
- **Tabs** under the head. On phones they drop their icons, bleed to the screen edges and fade at the end where more are hidden.
- **Studio:** what was made comes first (a list), then "Make something new" in three groups, Read (reports, mind map, infographic, slides), Practise (quiz, flashcards), Listen and watch (audio summary, podcast, video), laid out as up to three columns that stack on narrow screens.
- **Spacing** uses the 4px scale `--space-1`..`--space-7` (4, 8, 12, 16, 24, 32, 48). Tight inside a group, generous between groups.
- Touch screens (`pointer: coarse`) get 44px controls; small buttons and chips 36px.

## Elevation & Depth

Mostly flat and tonal: ground, rail and surface differ by lightness, groups are outlined by a hairline. Shadow is reserved for what floats:

- `--shadow-1`: a 1px lift under buttons and the selected segment.
- `--shadow-2`: sheets, the chat composer, the toast, the mind map rename field.
- Dark theme shadows are deeper and the hairlines carry the separation.

## Shapes

One radius family: 6px for small inline things (citation focus, code, transcript rows, slide frames), 10px for controls and notices, 14px for groups, cards, sheets and the toast, 18px for the top corners of a phone's bottom sheet, pills only for counts, chips and citations. No coloured side stripes: a graded quiz card tints its whole 1px border.

Icons: one line set on a 24px grid (`src/ui/icons.tsx`), 1.75 stroke, 2.25 for the current tab-bar item; muted when decorative, blue only where the accent rules allow.

## Components

### Buttons
- Default (secondary): white surface, hairline, 1px lift; hover strengthens the border; press scales to 0.98. One **primary** per area (accent fill). **Danger** only for the confirmed delete. **Link** for tertiary actions. **Icon buttons** are transparent with a soft hover.
- Disabled at 45% opacity, no lift.

### Inputs and forms
- 1px `--line-strong` border, 10px radius, 40px tall (44px on touch). Focus: accent border plus a 3px soft ring; checkboxes and radios take the accent colour and a 2px outline.
- Labels above fields (small 600), hints below (footnote, muted). Fieldsets of choices are outlined groups.
- Before anything leaves the device, a notice says what goes where ("The text of the selected sources is sent to …").

### Segmented control
- Native buttons with `aria-pressed` in a surface-2 track; the selected segment lifts to the surface. It sizes to its content unless `.wide`.

### Sidebar and tab bar
- Sidebar rows: ink text, muted icon; hover is a 5% ink wash. Only the current row speaks blue: Accent Soft fill, Accent Text, accent icon, 600.
- Tab bar items: muted label under a 24px icon; the current item in Accent Text with a heavier stroke, no pill.

### Lists
- A grouped list: a white 14px group, rows of at least 56px (48px compact) with a muted leading icon, title and metadata, a faint trailing chevron, a soft hover.

### Studio tiles
- A row in a grouped list: a 36px Accent Soft tile holding the type's icon, then the name (body 600) and one line of purpose (small, muted). The accessible name starts with the type's name.

### Artifact
- Breadcrumbs, editable title in an `h1`, Regenerate and Delete; a metadata line (type, age, version, sources); an **Export** toolbar of small buttons labelled by its visible caption; then the type's own view.

### Today
- One **next step** hero (Accent Soft, icon, one sentence, one primary action); when nothing is urgent it turns surface-2 with a green check. Up to four more steps as a compact list, then the courses.

### Empty states
- A soft surface-2 panel: an Accent Soft icon tile, a title (lead 650), one teaching sentence and, when there is one, the next action. Where the screen's own controls are the next action (the Studio's tiles), there is no empty state.

### Sheets
- Native modal `<dialog>`: a centred 560px panel (760px wide variant) with a sticky head; on phones a bottom sheet with 18px top corners inside the safe area. Opens with a short rise; the form's last row puts the primary action last.

### Toast
- An ink block above the tab bar (bottom centre of the page on wide screens), small text and text actions. Used for "A new version of amphi is ready" (Later, Reload): a new version never takes over mid-task.

### Notices and status
- Notices: surface-2 for information, danger-soft for errors (`role="alert"`), ok-soft for success. Offline failures say so in the student's language and what still works.
- Settings → This device states whether the app works offline.

### Citations
- `S1 §2` pills in Accent Soft inside prose, mind maps and cards; they open the source at the page or the minute.

### Motion
- 150ms for hovers, 220ms with an exponential ease-out for sheets and the toast. The recording dot pulses; nothing else loops except progress. Reduced motion drops all of it to instant state changes.

## Do's and Don'ts

### Do:
- **Do** use the accent only for the primary action, the current place, focus and progress.
- **Do** route every string through `t(en, fr, de)` and let German wrap; never fix a text width.
- **Do** say what leaves the device and to whom before it is sent, and say plainly when the network is missing.
- **Do** keep numbers tabular where they change (timers, scores, counts).
- **Do** use the tokens (`--fs-*`, `--space-*`, `--radius*`, colours) in every feature section of `src/styles.css`.

### Don't:
- **Don't** add confetti, streaks, badges or celebratory motion: progress is shown, not cheered.
- **Don't** add a coloured side stripe to a card, notice or list row.
- **Don't** introduce a second accent, gradient text, or decorative glass (the phone tab bar's blur is the one functional exception).
- **Don't** put inline `style` attributes in HTML strings (the CSP forbids them); React's `style` prop is fine for computed values.
- **Don't** load a font, image or script from another origin.
