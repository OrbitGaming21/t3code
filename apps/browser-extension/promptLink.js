import { browserApi } from "./browserApi.js";

// Mirrors packages/shared/src/promptLinks.ts; the extension loads unbuilt, so it cannot import it.
export const MAX_PROMPT_LENGTH = 8000;
export const DEFAULT_WEB_ORIGIN = "https://app.t3.codes";

/** @typedef {{ target: "app" | "web", webOrigin: string }} OpenSettings */
/** @typedef {{ kind: "repo", repo: string } | { kind: "pr", pr: string }} GithubContext */

export const DEFAULT_SETTINGS = /** @type {OpenSettings} */ ({
  target: "app",
  webOrigin: DEFAULT_WEB_ORIGIN,
});

const NOT_REPOSITORIES = new Set([
  "about",
  "apps",
  "enterprise",
  "explore",
  "features",
  "login",
  "marketplace",
  "notifications",
  "orgs",
  "pricing",
  "pulls",
  "issues",
  "search",
  "settings",
  "signup",
  "sponsors",
  "topics",
]);

/** @returns {GithubContext | null} */
export function githubContext(pageUrl) {
  if (!URL.canParse(pageUrl)) return null;
  const url = new URL(pageUrl);
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
  const [owner, name, section, number] = url.pathname.split("/").filter(Boolean);
  if (!owner || !name || NOT_REPOSITORIES.has(owner.toLowerCase())) return null;
  const repo = `${owner}/${name.replace(/\.git$/i, "")}`;
  if (section === "pull" && number && /^\d+$/.test(number)) {
    return { kind: "pr", pr: `${repo}/${number}` };
  }
  return { kind: "repo", repo };
}

function clip(text, length) {
  return text.length <= length ? text : `${text.slice(0, Math.max(0, length - 1)).trimEnd()}…`;
}

/** Builds the draft text, shortening the selection first so the prompt fits a link. */
export function composePrompt({ ask = "", page = null, selection = "" }) {
  const parts = [ask.trim()];
  if (page) parts.push(page.title ? `Page: ${page.title}\n${page.url}` : `Page: ${page.url}`);
  const head = parts.filter(Boolean).join("\n\n");
  const quoted = selection.trim();
  if (!quoted) return clip(head, MAX_PROMPT_LENGTH);
  const wrapper = `${head ? `${head}\n\n` : ""}Selected text:\n"""\n`;
  const room = MAX_PROMPT_LENGTH - wrapper.length - 4;
  if (room <= 0) return clip(head, MAX_PROMPT_LENGTH);
  return `${wrapper}${clip(quoted, room)}\n"""`;
}

/** @param {OpenSettings} settings @param {GithubContext | null} github */
export function buildPromptLink(prompt, settings, github = null) {
  const params = new URLSearchParams();
  if (prompt) params.set("prompt", prompt);
  if (github?.kind === "pr") params.set("pr", github.pr);
  if (github?.kind === "repo") params.set("repo", github.repo);
  if (settings.target === "app") return `t3code://new?${params}`;
  const origin = URL.canParse(settings.webOrigin) ? settings.webOrigin : DEFAULT_WEB_ORIGIN;
  const url = new URL("/new", origin);
  url.search = params.toString();
  return url.toString();
}

/** @returns {Promise<OpenSettings>} */
export async function readSettings() {
  const stored = await browserApi().storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

/** The app scheme hands off to T3 Code without leaving the page; the web app needs a tab. */
export async function openPromptLink(link, tabId) {
  if (link.startsWith("t3code:") && tabId !== undefined) {
    await browserApi().tabs.update(tabId, { url: link });
  } else {
    await browserApi().tabs.create({ url: link });
  }
}
