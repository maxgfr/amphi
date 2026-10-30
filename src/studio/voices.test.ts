import { describe, expect, test } from "bun:test";
import { audioLines, audioScript } from "./audio.tsx";
import { type PodcastData, podcastLines, podcastMarkdown, podcastScript } from "./podcast.tsx";

describe("audio summary script", () => {
  test("paragraphs are cleaned of citation labels and blanks", () => {
    const s = audioScript.parse({ title: " Entropy ", paragraphs: ["Entropy measures disorder [S1 §1].", "  ", "It   never decreases."] });
    expect(s).toEqual({ title: "Entropy", paragraphs: ["Entropy measures disorder.", "It never decreases."] });
    expect(audioLines({ paragraphs: s.paragraphs })).toEqual([
      { speaker: 0, text: "Entropy measures disorder." },
      { speaker: 0, text: "It never decreases." },
    ]);
  });

  test("an empty script is refused", () => {
    expect(audioScript.safeParse({ title: "x", paragraphs: [" "] }).success).toBe(false);
    expect(audioScript.safeParse({ paragraphs: ["a"] }).success).toBe(false);
  });
});

describe("podcast script", () => {
  const answer = {
    title: "The second law",
    hosts: ["Léa", "Tom"],
    sections: [
      {
        title: "Opening",
        turns: [
          { host: 1, text: "Welcome [S1 p.2]!" },
          { host: "2", text: "Hi Léa." },
        ],
      },
      { title: "Empty", turns: [{ host: 2, text: " " }] },
      { title: "Entropy", turns: [{ host: 2, text: "So what is entropy?" }] },
    ],
  };

  test("hosts become speakers 0 and 1; empty turns and sections go", () => {
    const s = podcastScript.parse(answer);
    expect(s.sections).toEqual([
      {
        title: "Opening",
        turns: [
          { speaker: 0, text: "Welcome!" },
          { speaker: 1, text: "Hi Léa." },
        ],
      },
      { title: "Entropy", turns: [{ speaker: 1, text: "So what is entropy?" }] },
    ]);
  });

  test("a third host, missing hosts or no turns at all are refused", () => {
    expect(podcastScript.safeParse({ ...answer, sections: [{ title: "x", turns: [{ host: 3, text: "Hi" }] }] }).success).toBe(false);
    expect(podcastScript.safeParse({ ...answer, hosts: ["Léa"] }).success).toBe(false);
    expect(podcastScript.safeParse({ ...answer, sections: [{ title: "x", turns: [] }] }).success).toBe(false);
  });

  test("lines to read, chapters at each section's first line, and the Markdown script", () => {
    const s = podcastScript.parse(answer);
    const data: PodcastData = { tone: "lecture", minutes: 5, hosts: s.hosts, sections: s.sections };
    const { lines, chapters } = podcastLines(data);
    expect(lines.map((l) => l.speaker)).toEqual([0, 1, 1]);
    expect(chapters).toEqual([
      { title: "Opening", cue: 0 },
      { title: "Entropy", cue: 2 },
    ]);
    expect(podcastMarkdown("The second law", data)).toBe("# The second law\n\n## Opening\n\n**Léa:** Welcome!\n\n**Tom:** Hi Léa.\n\n## Entropy\n\n**Tom:** So what is entropy?\n");
  });
});
