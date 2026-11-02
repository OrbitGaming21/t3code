import { browserApi } from "./browserApi.js";

import { DEFAULT_WEB_ORIGIN, readSettings } from "./promptLink.js";

const form = /** @type {HTMLFormElement} */ (document.getElementById("form"));
const webOrigin = /** @type {HTMLInputElement} */ (document.getElementById("web-origin"));
const saved = /** @type {HTMLElement} */ (document.getElementById("saved"));

const settings = await readSettings();
const selected = form.querySelector(`input[name="target"][value="${settings.target}"]`);
if (selected instanceof HTMLInputElement) selected.checked = true;
webOrigin.value = settings.webOrigin;
webOrigin.disabled = settings.target !== "web";

form.addEventListener("change", async () => {
  const target = new FormData(form).get("target") === "web" ? "web" : "app";
  webOrigin.disabled = target !== "web";
  const origin = webOrigin.value.trim();
  const valid = URL.canParse(origin) && /^https?:$/.test(new URL(origin).protocol);
  await browserApi().storage.sync.set({
    target,
    webOrigin: valid ? new URL(origin).origin : DEFAULT_WEB_ORIGIN,
  });
  saved.textContent =
    valid || origin === "" ? "Saved." : "That address is not valid. Using app.t3.codes.";
});
