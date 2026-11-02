import {
  buildPromptLink,
  composePrompt,
  githubContext,
  openPromptLink,
  readSettings,
} from "./promptLink.js";

const form = /** @type {HTMLFormElement} */ (document.getElementById("form"));
const ask = /** @type {HTMLTextAreaElement} */ (document.getElementById("ask"));
const includePage = /** @type {HTMLInputElement} */ (document.getElementById("include-page"));
const includeSelection = /** @type {HTMLInputElement} */ (
  document.getElementById("include-selection")
);
const selectionRow = /** @type {HTMLElement} */ (document.getElementById("selection-row"));
const selectionLabel = /** @type {HTMLElement} */ (document.getElementById("selection-label"));
const githubHint = /** @type {HTMLElement} */ (document.getElementById("github-hint"));
const send = /** @type {HTMLButtonElement} */ (document.getElementById("send"));

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const pageUrl = tab?.url && /^https?:/.test(tab.url) ? tab.url : null;
const github = pageUrl ? githubContext(pageUrl) : null;
const settings = await readSettings();

if (!pageUrl) {
  includePage.checked = false;
  includePage.disabled = true;
}
if (github) {
  githubHint.hidden = false;
  githubHint.textContent =
    github.kind === "pr"
      ? `Opens on pull request ${github.pr.replace(/\/(\d+)$/, " #$1")}.`
      : `Opens in your ${github.repo} project.`;
}
send.textContent = settings.target === "app" ? "Open in T3 Code" : "Open in T3 Code web";

// Restricted pages (chrome://, the Web Store) reject script injection; they just have no selection.
let selection = "";
if (tab?.id !== undefined && pageUrl) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString() ?? "",
    });
    selection = typeof result?.result === "string" ? result.result.trim() : "";
  } catch {
    selection = "";
  }
}
if (selection) {
  selectionRow.hidden = false;
  const words = selection.split(/\s+/).length;
  selectionLabel.textContent = `Include selected text (${words} ${words === 1 ? "word" : "words"})`;
}

const draftPrompt = () =>
  composePrompt({
    ask: ask.value,
    page: includePage.checked && pageUrl ? { title: tab?.title ?? "", url: pageUrl } : null,
    selection: includeSelection.checked ? selection : "",
  });
// A pull request link opens its thread even without a prompt.
const canSend = () => draftPrompt().length > 0 || github?.kind === "pr";
const refresh = () => {
  send.disabled = !canSend();
};
ask.addEventListener("input", refresh);
includePage.addEventListener("change", refresh);
includeSelection.addEventListener("change", refresh);
refresh();

ask.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) form.requestSubmit();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!canSend()) return;
  await openPromptLink(buildPromptLink(draftPrompt(), settings, github), tab?.id);
  window.close();
});

document.getElementById("settings")?.addEventListener("click", (event) => {
  event.preventDefault();
  void chrome.runtime.openOptionsPage();
});
