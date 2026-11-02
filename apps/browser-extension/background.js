import { browserApi } from "./browserApi.js";

import {
  buildPromptLink,
  composePrompt,
  githubContext,
  openPromptLink,
  readSettings,
} from "./promptLink.js";

browserApi().runtime.onInstalled.addListener(async () => {
  await browserApi().contextMenus.removeAll();
  browserApi().contextMenus.create({
    id: "ask-selection",
    title: "Ask T3 Code about “%s”",
    contexts: ["selection"],
  });
  browserApi().contextMenus.create({
    id: "ask-page",
    title: "Ask T3 Code about this page",
    contexts: ["page"],
  });
  browserApi().contextMenus.create({
    id: "ask-link",
    title: "Ask T3 Code about this link",
    contexts: ["link"],
  });
});

browserApi().contextMenus.onClicked.addListener(async (info, tab) => {
  const pageUrl = info.menuItemId === "ask-link" ? info.linkUrl : (tab?.url ?? info.pageUrl);
  if (!pageUrl) return;
  const page = { title: info.menuItemId === "ask-link" ? "" : (tab?.title ?? ""), url: pageUrl };
  const prompt = composePrompt({
    page,
    selection: info.menuItemId === "ask-selection" ? (info.selectionText ?? "") : "",
  });
  const settings = await readSettings();
  await openPromptLink(buildPromptLink(prompt, settings, githubContext(pageUrl)), tab?.id);
});
