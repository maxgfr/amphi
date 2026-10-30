---
name: amphi
description: The student's binder. Grey pressboard, white paper sheets, a charcoal spine, and one coloured divider per course.
colors:
  pressboard: "oklch(92.2% 0.005 245)"
  pressboard-deep: "oklch(88.6% 0.007 245)"
  paper: "oklch(99.6% 0.0015 245)"
  paper-2: "oklch(96.4% 0.004 245)"
  spine: "oklch(23.5% 0.012 258)"
  spine-text: "oklch(94% 0.005 245)"
  spine-muted: "oklch(74% 0.012 250)"
  line: "oklch(88.5% 0.006 245)"
  line-strong: "oklch(62% 0.01 250)"
  ink: "oklch(21% 0.014 260)"
  ink-hover: "oklch(32% 0.016 260)"
  on-ink: "oklch(99% 0 0)"
  ink-soft: "oklch(91% 0.006 245)"
  muted: "oklch(44% 0.014 255)"
  highlighter: "oklch(92% 0.1 98)"
  danger: "oklch(52% 0.19 28)"
  danger-soft: "oklch(95.2% 0.03 28)"
  ok: "oklch(49% 0.12 152)"
  ok-soft: "oklch(95% 0.035 152)"
  warn: "oklch(55% 0.13 70)"
  warn-soft: "oklch(95.5% 0.045 85)"
  divider-grey: "oklch(80% 0.012 250)"
  divider-vermilion: "oklch(71% 0.155 36)"
  divider-saffron: "oklch(83% 0.14 82)"
  divider-olive: "oklch(81% 0.135 120)"
  divider-green: "oklch(76% 0.125 158)"
  divider-teal: "oklch(77% 0.095 204)"
  divider-cobalt: "oklch(73% 0.115 258)"
  divider-violet: "oklch(74% 0.12 312)"
  dark-pressboard: "oklch(17.5% 0.008 258)"
  dark-pressboard-deep: "oklch(21% 0.009 258)"
  dark-paper: "oklch(22.5% 0.009 258)"
  dark-paper-2: "oklch(26.5% 0.01 258)"
  dark-spine: "oklch(13.5% 0.008 258)"
  dark-line: "oklch(31% 0.012 258)"
  dark-line-strong: "oklch(54% 0.012 258)"
  dark-ink: "oklch(94% 0.005 245)"
  dark-on-ink: "oklch(19% 0.012 260)"
  dark-muted: "oklch(73% 0.01 255)"
  dark-highlighter: "oklch(40% 0.08 98)"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 760
    lineHeight: 1.15
    letterSpacing: "-0.024em"
    fontVariation: "'wdth' 106"
  wordmark:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 820
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontVariation: "'wdth' 118"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 740
    lineHeight: 1.15
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 104"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.3125rem"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.012em"
  tab:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 720
    lineHeight: 1.3
    letterSpacing: "-0.01em"
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
    fontWeight: 500
    lineHeight: 1.5
    fontFeature: "'tnum'"
  footnote:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
  caption:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 650
    fontFeature: "'tnum'"
rounded:
  sm: "4px"
  md: "7px"
  lg: "10px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "4px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
    textColor: "{colors.on-ink}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "4px 16px"
    height: "40px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.md}"
    height: "40px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  spine-nav-item:
    backgroundColor: "{colors.spine}"
    textColor: "{colors.spine-text}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "40px"
  spine-nav-item-current:
    backgroundColor: "{colors.pressboard}"
    textColor: "{colors.ink}"
  divider:
    backgroundColor: "{colors.divider-vermilion}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "24px 24px 16px"
  folder-tab:
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "42px"
  folder-tab-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  binder-tab:
    backgroundColor: "{colors.divider-cobalt}"
    textColor: "{colors.ink}"
    typography: "{typography.tab}"
    padding: "8px 24px 4px 16px"
  next-step:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.lg}"
    padding: "24px 32px"
  citation:
    backgroundColor: "{colors.ink-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 0.45em"
  citation-hover:
    backgroundColor: "{colors.highlighter}"
  hue-swatch:
    backgroundColor: "{colors.divider-teal}"
    rounded: "{rounded.md}"
    size: "36px"
---

# Design System: amphi

## Overview

**Creative North Star: "The Course Binder"**

amphi is the binder a student carries out of the lecture hall. The ground is grey pressboard, the binder's cover; everything one reads or works in is a white paper sheet laid on it; the sidebar is the binder's charcoal spine. Each course is a pressboard divider with its own colour and a tab cut into its edge, and everything inside the course (lessons, sources, studio, chat, progress) is filed behind that divider. The student knows which course they are in from the colour alone, from the course list down to a single artifact or source.

The world is calm and printed rather than glowing. Colour is spent on identity, never on urgency: seven divider hues at full strength, one per course, and ink black for the one thing on a screen that acts. Density is that of a well-kept folder: sheets with generous padding, ruled groups, counts set in right-aligned tabular columns like a contents page. Display type is Archivo, a sturdy grotesque with a width axis, used where a divider would be printed (titles, tabs, the wordmark, large counts); the body stays in the platform's own sans so long reading and long German strings feel native. In the evening the binder turns black, the sheets charcoal, and the dividers drop a step deeper. The rejected default is the grey SaaS sidebar with white cards and one blue accent everywhere.

**Key Characteristics:**
- Grey pressboard ground, white paper sheets, a charcoal spine.
- Seven divider hues, one per course, used as identity only.
- Ink is the only colour that acts.
- Folder tabs on the divider's lower edge; the selected tab joins the sheet below.
- Tab-shaped course markers with cut corners, stepped across the width in the course list.
- Archivo for the printed voice, the system sans for reading.
- Counts and durations tabular and right-aligned.

## Colors

A neutral binder of cool greys and paper white, carried by one ink and seven pressboard divider hues.

### Primary
- **Ink** (ink): the one colour that acts. Primary buttons, links, citations, the focus outline and halo, the progress bar, the caret, checkbox and range fills, the selected tab's underline, the outline around the chosen hue swatch. Also the text colour, so action reads as weight and fill, never as a new hue. Hover deepens to **Ink Hover**; text on an ink fill is **On Ink**. In the evening ink inverts to near-white (dark-ink) with dark text on it (dark-on-ink).
- **Ink Soft** (ink-soft): the resting fill of a citation pill.

### Secondary: the dividers
The seven divider hues are the course's identity. Each is defined by three numbers (lightness, chroma, hue) and every course role is derived from them, so a course carries one colour through the whole app:
- **Vermilion** (divider-vermilion), **Saffron** (divider-saffron), **Olive** (divider-olive), **Green** (divider-green), **Teal** (divider-teal), **Cobalt** (divider-cobalt), **Violet** (divider-violet).
- **Grey Divider** (divider-grey): the plain divider for screens outside a course (Settings, Discover).
- Derived roles per hue: the full-strength **course** colour (divider band, binder entry, rail and step markers, the course crumb, hue swatches); **course-soft**, a pale wash of the same hue at 93.5% lightness and 40% of its chroma (a lesson or source divider, the icon tile of the next step and empty states, the count on a selected tab); **on-course**, a near-black tinted with the hue, for every word set on a divider.
- A course's hue is stored with the course and synced; an older course without one takes a hue from a hash of its id, the same on every device. A new course is offered the hue the fewest courses already use, so neighbouring dividers differ.
- Evening: each divider drops 7 points of lightness and 8% of its chroma; course-soft becomes a dark wash at 33% lightness. A lesson or source divider in the evening is a charcoal sheet (dark-paper-2); its course crumb keeps the full colour.

### Tertiary: the highlighter
- **Highlighter** (highlighter): a pale marker yellow. Text selection, quoted passages in generated prose (at 70%), a hovered citation, recording marker chips, a marked transcript line. It says "this was marked", as a student marks a printed page. Evening: dark-highlighter.

### Neutral
- **Pressboard** (pressboard): the page ground, the binder cover. **Pressboard Deep** (pressboard-deep): the track of a segmented control, the count pill on plain tabs.
- **Paper** (paper): the white paper sheets: every sheet, card, list, input, dialog and the selected folder tab. **Paper 2** (paper-2): notices, table heads, the progress track.
- **Spine** (spine), **Spine Text** (spine-text), **Spine Muted** (spine-muted): the sidebar and the phone top bar, its labels and its quiet icons and course names.
- **Line** (line): hairlines between rows and around cards. **Line Strong** (line-strong): input borders, hovered borders, crumb separators.
- **Muted** (muted): secondary text, metadata, idle tabs, leading icons.
- **Status**: danger and danger-soft (the confirmed delete, error notices), ok and ok-soft (success notices, the calm next step), warn and warn-soft. Status colours report; they do not decorate.

### Fixed palettes
Slides, their print sheet and exported material are drawn on their own fixed light palette, with their own blue accent and six chart colours, so a deck looks the same presented, printed or exported in either theme. That palette never leaks into the app, and the app's tokens never restyle a slide.

### Named Rules
**The Ink Acts Rule.** Only ink acts: primary buttons, links, citations, focus, progress. Text links are always underlined, since their ink matches the body text. If a control, a link or a progress bar is drawn in a divider hue, it is wrong.

**The Identity Rule.** A divider hue says which course, nothing else. It never marks state, urgency, success or selection, and selection is said by shape and weight (the lit rail tab grows, the selected folder tab turns to paper), never by hue alone.

**The Dark Ink On Dividers Rule.** Text on a divider is always the hue's dark on-course ink, in both themes. White text never sits on a divider.

**The Highlighter Rule.** What is selected or quoted is highlighted with the marker yellow, not tinted with ink or a course hue.

## Typography

**Display Font:** Archivo (variable weight 100 to 900, width 62% to 125%), self-hosted under the SIL Open Font License, Latin subset, with the system sans as fallback.
**Body Font:** the platform's system sans (ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue).
**Mono:** the system monospace, for timers and code.

**Character:** Archivo is the printed label on a pressboard divider: heavy, slightly widened, tight in tracking. The system sans is the handwriting on the sheets: familiar, quiet, fast to read in three languages.

### Hierarchy
- **Display** (760, 2.25rem, 1.15, width 106%): the page title. 1.75rem on phones.
- **Wordmark** (820, 1.5rem, 1, width 118%): "amphi" at the head of the spine. 1.375rem on phones.
- **Headline** (740, 1.625rem, width 104%): the editable title of an artifact and the title on a lesson or source divider.
- **Title** (650, 1.3125rem, 1.3): the sentence of Today's next step; at 760 for the large counts in a binder entry.
- **Tab** (720, 1.125rem, 1.3): the course name on a binder tab. The same face at 700 sets section titles and empty-state titles; at 600 to 750 and width 96% it sets plain tabs.
- **Body** (400, 1rem, 1.55): all reading text, capped at a 70ch measure.
- **Control** (500, 0.9375rem, 1.25): buttons, sidebar rows; the primary button at 650.
- **Small / Footnote / Caption** (0.875rem / 0.8125rem / 0.75rem): metadata, hints, counts.

### Named Rules
**The Printed Voice Rule.** Archivo is for what would be printed on a divider: titles, tabs, the wordmark, large counts. Paragraphs, controls and form labels stay in the system sans.

**The Contents Page Rule.** Numbers that are counted or that change (lesson and source counts, durations, timers, scores) are tabular, and in lists they sit right-aligned in columns.

**The Fixed Scale Rule.** The app uses the fixed type scale; no fluid sizes.

## Layout

On wide screens the shell is a 248px charcoal spine beside the page. The spine runs the full height and holds, top to bottom: the wordmark, the four places (Today, Courses, Discover, Settings), the courses filed as divider tabs, then the language switch, sync and theme. The page is centred at 1120px (800px for narrow screens such as recording), with 32px top and 48px side padding, 32px below 1100px.

Inside a course every screen opens with its divider: a full-width band in the course colour holding the crumbs, the title, its facts and actions, and on the course screen the folder tabs on its lower edge. The work sits on one paper sheet filed directly under it: the divider loses its lower corners, the sheet loses its upper ones, and the two join with no gap. A lesson, a source or an artifact uses the soft divider of the same hue.

The course list is the binder: one divider per course, stacked 8px apart, whose tabs step across the width in a cycle of four (0, 18%, 36%, 54%), as the tabs of real dividers do. Each entry carries its counts right-aligned in columns and, when there is one, the exam countdown.

Spacing runs on a 4px base (4, 8, 12, 16, 24, 32, 48), with more air above a section (24px) than inside it.

Below 760px the spine becomes a charcoal top bar (wordmark, tools) and the places move to a translucent bottom tab bar; the course list in the spine hides. Dividers and their sheets run edge to edge, square-cornered, inside the safe areas. Below 560px a divider's action buttons drop their visible labels to keep one row (labels remain for assistive tech). On touch screens every target is at least 44px.

### Named Rules
**The Filed Sheet Rule.** Inside a course, content is filed on one sheet joined to the divider above it, never floated as a separate card below it.

**The Ruled Not Boxed Rule.** Inside a divider's sheet, groups are ruled, not boxed: lists, group lists and concepts drop their outer border, radius and fill, and are separated by hairlines.

**The Stepped Tabs Rule.** In the binder, each tab sits further right than the one above it, in a cycle of four.

## Elevation & Depth

Depth is paper on board: mostly tonal (paper on pressboard, the spine darker than both), with two shadows. Sheets, the next step and secondary buttons rest on a one-pixel paper shadow. Things that float above the binder (dialogs, the toast, the skip link) and a hovered binder entry take the lifted shadow. The phone tab bar is translucent paper with a blur so the page is felt scrolling under it; that is the only glass.

### Shadow Vocabulary
- **Paper rest** (`box-shadow: 0 1px 2px oklch(20% 0.012 260 / 0.08)`): a sheet lying on the board.
- **Lifted** (`box-shadow: 0 14px 34px -10px oklch(20% 0.012 260 / 0.28), 0 2px 6px oklch(20% 0.012 260 / 0.07)`): dialogs, the toast, a hovered binder entry.
- **Focus halo** (`box-shadow: 0 0 0 3px oklch(21% 0.014 260 / 0.22)`): a focused input, with its border turned to ink.

### Named Rules
**The Paper Lift Rule.** Paper rests flat with a hairline shadow; only what floats over the binder, or a divider being pulled out on hover, lifts.

## Shapes

Pressboard corners, barely rounded: 4px for small marks (crumb tab, swatch focus, slide frame), 7px for controls and inputs, 10px for dividers, sheets, cards and dialogs. Full pills only for small counters and chips: tab counts, citation pills, the exam countdown, filter chips. On phones a dialog becomes a bottom sheet with 18px top corners.

Course markers are tabs cut by a clip path, not rounded boxes: the binder tab is a trapezoid with 10px chamfers at its top corners; the rail marker and the step marker are small tabs whose right edge is cut in by 3 to 4px; the tab that rises from the next-step sheet has its top right corner cut by 10px.

### Named Rules
**The Cut Corner Rule.** A course is marked by a tab with a cut corner in its divider colour; never by a dot, a stripe or a coloured border.

## Components

### Buttons
Quiet paper by default, ink for the one thing that matters.
- **Shape:** 7px corners, 40px tall (44px on touch), 4px by 16px padding.
- **Primary:** ink fill, on-ink text, weight 650. One per area. Hover deepens to ink hover.
- **Secondary:** paper fill, a 16% ink hairline, the paper rest shadow; hover strengthens the border to line strong. On a full-colour divider secondary buttons become a lighter card of the divider's own colour with on-course text.
- **Danger:** danger fill, only for a confirmed delete.
- **Link and icon buttons:** no fill. Links (text links and link buttons) are ink and always underlined (1px, offset 0.2em; 2px on hover), because ink alone does not set them apart from body text. Icon buttons are muted with a faint wash on hover.
- **States:** press drops by 1px; disabled at 45% opacity, no shadow. Focus is a 2px ink outline offset by 2px.

### Inputs / Fields
- **Style:** paper fill, line-strong border, 7px corners, 40px tall; labels above (small, 650), hints below (footnote, muted).
- **Focus:** border turns to ink and the 3px focus halo appears.
- **Choices:** checkboxes, radios and ranges are filled with ink. Outlined fieldsets hold long choice lists.

### Navigation
- **Spine rows:** spine text at 500 with a muted icon; hover is a faint white wash. The current place is cut from the page: it takes the pressboard ground, ink text at 650, and loses its right-hand corners so it joins the page.
- **Courses in the spine:** muted rows with a 12px divider tab in the course colour; the open course lights up (spine text, 650) and its tab grows to 22px. The open course stays lit down to its artifacts and sources.
- **Phone tab bar:** muted label under a 24px icon; the current place in ink with a heavier stroke, no pill.
- **Crumbs:** muted links separated by slashes; inside a course the first crumb is the course's own small divider tab, filled with its colour.

### Divider (signature)
The head of every screen inside a course, and of Settings and Discover in grey.
- **Full:** course colour fill, on-course text, 10px corners, 24px padding (16px at the bottom), with crumbs, title, facts (a large Archivo number before each label, tabular) and actions.
- **Soft:** course-soft fill and ink text, for a lesson, a source, an artifact or a recording; its title drops to headline size.
- **Folder tabs:** sit on the divider's lower edge with 7px top corners, 42px tall, weight 600. Idle tabs are lighter card cut from the divider (white at 36%, 62% on hover); the selected tab turns to paper with ink text at 700 and joins the sheet below. Outside a divider, tabs are plain text in Archivo over a hairline, the selected one underlined with 3px of ink.

### Binder entry (signature)
One course in the binder or on Today.
- **Tab:** course colour, chamfered trapezoid, Archivo course name with its emoji, stepped across the width; it rises 3px on hover.
- **Body:** course colour, 10px corners (the first entry of each cycle keeps its top-left square so the tab joins it), at least 60px tall; lesson and source counts right-aligned in columns (count in Archivo at title size; a zero count is quiet through weight only, set plain in the body sans at 500, never faded); an exam countdown in a pale pill. Hover lifts the body; focus is a 3px paper gap and 2px of ink around it.

### Next step
Today's one next action.
- A paper sheet with 10px corners and 24px by 32px padding: an icon in a course-soft tile, one sentence in Archivo at title size, one primary ink button. When the step belongs to a course, a 112px tab in the course colour rises from its top edge. When nothing is urgent, the icon tile turns ok-soft with a green check. Further steps follow as a compact list, each row marked by a small cut-corner step tab.

### Lists
- Rows of at least 56px (48px compact): a muted leading icon, title at 600, right-aligned tabular metadata, a faint trailing chevron that moves 2px on hover. On their own they are a paper group with a hairline border; on a divider's sheet they are ruled only.

### Hue swatches
- The seven dividers as 36px swatches with 7px corners in the course form. The chosen one is outlined in ink (a 2px paper gap, then 2px of ink) and carries a small on-course dot.

### Citations
- Small pills (0.75em, 600) in ink-soft with a hairline, inside prose, mind maps and cards; hover turns them highlighter yellow. They open the source at the page or the minute.

### Sheets and toast
- Native modal dialogs: a 560px paper panel (760px wide variant), 10px corners, a hairline and the lifted shadow; a bottom sheet on phones. The toast is an ink block with pressboard text and text actions.

### Empty states
- A dashed outline with 10px corners, a course-soft icon tile, a title in Archivo, one teaching sentence and, when there is one, the next action in ink.

### Motion
- Hovers and state changes in 150ms, larger moves in 240ms, on an exponential ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`). As a screen opens its folder tabs and binder tabs rise 10px from behind their divider, one after another, 40ms apart. Dialogs rise 8px. Nothing loops except progress and the recording, typing and sync indicators. Reduced motion makes every change instant.

## Do's and Don'ts

### Do:
- **Do** give every course one of the seven divider hues and carry it through the course: divider, crumb, rail tab, binder entry, next-step tab.
- **Do** keep ink as the only colour that acts: primary buttons, links, citations, focus, progress.
- **Do** highlight selection and quoted passages with the highlighter yellow.
- **Do** file a course's content on one paper sheet joined to its divider, and rule the groups on it.
- **Do** set titles, tabs and large counts in Archivo, and reading text in the system sans.
- **Do** keep counts and durations tabular and right-aligned; quiet a zero count by weight, never by opacity.
- **Do** underline every text link.
- **Do** use the tokens (`--fs-*`, `--space-*`, `--radius*`, colours, `--course*`) in every feature section of `src/styles.css`.
- **Do** let German strings wrap; never fix a text width.

### Don't:
- **Don't** use a divider hue for an action, a link, a state or a selection.
- **Don't** put white text on a divider.
- **Don't** add a coloured side stripe to a card, notice, list row or transcript line.
- **Don't** add eyebrow labels (small uppercase, letter-spaced lines above a title).
- **Don't** box groups inside a divider's sheet.
- **Don't** restyle slides or exports with the app's tokens; they keep their own fixed palette.
- **Don't** add a second accent, gradient text or decorative glass (the phone tab bar's blur is the one functional exception).
- **Don't** add confetti, streaks, badges or celebratory motion: progress is shown, not cheered.
- **Don't** load a font, image or script from another origin; Archivo is served from the site itself.
- **Don't** put inline `style` attributes in HTML strings (the CSP forbids them); React's `style` prop is fine for computed values.
