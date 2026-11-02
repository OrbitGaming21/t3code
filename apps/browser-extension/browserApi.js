// Firefox exposes promise APIs through browser; Chrome exposes them through chrome.
export const browserApi = () => globalThis.browser ?? globalThis.chrome;
