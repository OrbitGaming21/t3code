import { parseNewThreadLink, promptLinkAppPath } from "@t3tools/shared/promptLinks";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_SETTINGS,
  MAX_PROMPT_LENGTH,
  buildPromptLink,
  composePrompt,
  githubContext,
} from "./promptLink.js";

describe("githubContext", () => {
  it("reads repositories and pull requests from GitHub pages", () => {
    expect(githubContext("https://github.com/pingdotgg/t3code/blob/main/README.md")).toEqual({
      kind: "repo",
      repo: "pingdotgg/t3code",
    });
    expect(githubContext("https://github.com/pingdotgg/t3code/pull/42/files")).toEqual({
      kind: "pr",
      pr: "pingdotgg/t3code/42",
    });
  });

  it("ignores GitHub pages that are not repositories and other sites", () => {
    expect(githubContext("https://github.com/settings/profile")).toBeNull();
    expect(githubContext("https://github.com/pingdotgg")).toBeNull();
    expect(githubContext("https://gitlab.com/owner/name")).toBeNull();
    expect(githubContext("not a url")).toBeNull();
  });
});

describe("composePrompt", () => {
  it("puts the request first, then the page, then the quoted selection", () => {
    expect(
      composePrompt({
        ask: "Explain this",
        page: { title: "Docs", url: "https://example.com/docs" },
        selection: "const a = 1;",
      }),
    ).toBe(
      'Explain this\n\nPage: Docs\nhttps://example.com/docs\n\nSelected text:\n"""\nconst a = 1;\n"""',
    );
  });

  it("shortens a long selection so the prompt fits a link", () => {
    const prompt = composePrompt({
      ask: "Summarize",
      page: { title: "", url: "https://example.com" },
      selection: "word ".repeat(5000),
    });
    expect(prompt.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH);
    expect(prompt.startsWith("Summarize\n\nPage: https://example.com")).toBe(true);
    expect(prompt.endsWith('…\n"""')).toBe(true);
  });
});

describe("buildPromptLink", () => {
  it("builds app links that T3 Code opens as a draft", () => {
    const link = buildPromptLink("Fix the build", DEFAULT_SETTINGS, {
      kind: "repo",
      repo: "owner/name",
    });
    const path = promptLinkAppPath(link);
    expect(path).not.toBeNull();
    expect(parseNewThreadLink(new URL(path!, "http://x").search)).toMatchObject({
      ok: true,
      value: { kind: "new", prompt: { text: "Fix the build" }, repository: { name: "name" } },
    });
  });

  it("builds web links on the configured server and pull request links", () => {
    const link = buildPromptLink(
      "Review",
      { target: "web", webOrigin: "http://localhost:3773" },
      { kind: "pr", pr: "owner/name/7" },
    );
    const url = new URL(link);
    expect(url.origin + url.pathname).toBe("http://localhost:3773/new");
    expect(parseNewThreadLink(url.search)).toMatchObject({
      ok: true,
      value: { kind: "pull-request", pullRequest: { number: 7 } },
    });
  });
});
