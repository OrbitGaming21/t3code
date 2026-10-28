import { describe, expect, it } from "vite-plus/test";

import { spokenReplyText } from "./speechOutput";

describe("spokenReplyText", () => {
  it("drops code blocks, links, and markdown markup", () => {
    const reply = [
      "## Done",
      "",
      "I updated **`ChatComposer.tsx`** — see [the diff](https://example.com/diff).",
      "",
      "```ts",
      "const secret = 1;",
      "```",
      "",
      "- Tests pass",
      "1. Ship it",
    ].join("\n");
    expect(spokenReplyText(reply)).toBe(
      "Done I updated ChatComposer.tsx — see the diff. Tests pass Ship it",
    );
  });

  it("cuts long replies at a sentence boundary", () => {
    const sentence = "This sentence is exactly fifty characters long ok. ";
    const spoken = spokenReplyText(sentence.repeat(40));
    expect(spoken.length).toBeLessThanOrEqual(1500);
    expect(spoken.endsWith("ok.")).toBe(true);
  });
});
