import {
  DEFAULT_USAGE_DISPLAY_SETTINGS,
  DesktopMenuBarSummarySchema,
  type DesktopMenuBarSummary,
} from "@t3tools/contracts";
import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { SET_MENU_BAR_SUMMARY_CHANNEL } from "../channels.ts";
import { menuBarPanelHtml } from "./menuBarPanel.ts";

export const installMenuBarSummary = Effect.fn("desktop.ipc.installMenuBarSummary")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const platform = yield* HostProcess.Platform;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let tray: Electron.Tray | null = null;
  let panel: Electron.BrowserWindow | null = null;
  let summary: DesktopMenuBarSummary = { items: [] };
  let loadVersion = 0;

  const closePanel = () => {
    if (panel !== null && !panel.isDestroyed()) panel.destroy();
    panel = null;
  };
  const loadPanel = (window: Electron.BrowserWindow) => {
    const version = ++loadVersion;
    void window
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(menuBarPanelHtml(summary))}`)
      .catch((error: unknown) => {
        if (window.isDestroyed() || version !== loadVersion) return;
        closePanel();
        void runPromise(Effect.logWarning("Could not display the menu bar usage panel", error));
      });
  };
  const panelBounds = () => {
    if (tray === null || tray.isDestroyed()) return null;
    const anchor = tray.getBounds();
    const { workArea } = Electron.screen.getDisplayMatching(anchor);
    const display = summary.display ?? DEFAULT_USAGE_DISPLAY_SETTINGS;
    const widths = { compact: 360, comfortable: 400, large: 480 };
    const width = Math.min(widths[display.menuSize], workArea.width - 16);
    const quotaCount = display.hidden.includes("limits")
      ? 0
      : summary.items.filter((item) => item.usedPercent !== undefined).length;
    const scale = display.menuSize === "large" ? 1.15 : display.menuSize === "compact" ? 0.9 : 1;
    const height = Math.min(Math.round((344 + quotaCount * 160) * scale), workArea.height - 16);
    return {
      width,
      height,
      x: Math.round(
        Math.max(
          workArea.x + 8,
          Math.min(
            anchor.x + anchor.width / 2 - width / 2,
            workArea.x + workArea.width - width - 8,
          ),
        ),
      ),
      y: Math.round(
        Math.max(
          workArea.y + 8,
          Math.min(anchor.y + anchor.height + 6, workArea.y + workArea.height - height - 8),
        ),
      ),
    };
  };
  const togglePanel = () => {
    if (panel !== null && !panel.isDestroyed()) {
      closePanel();
      return;
    }
    if (tray === null || tray.isDestroyed()) return;
    const bounds = panelBounds();
    if (!bounds) return;
    const window = new Electron.BrowserWindow({
      ...bounds,
      type: "panel",
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      roundedCorners: true,
      backgroundColor: summary.theme === "dark" ? "#1c1c1e" : "#fafafa",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    panel = window;
    window.once("ready-to-show", () => {
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
      }
    });
    window.on("blur", closePanel);
    window.once("closed", () => {
      if (panel === window) panel = null;
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("before-input-event", (event, input) => {
      if (input.key === "Escape") {
        event.preventDefault();
        closePanel();
      }
    });
    window.webContents.on("will-navigate", (event, url) => {
      event.preventDefault();
      const action = new URL(url);
      if (action.origin !== "https://t3-menu.invalid" || action.search || action.hash) return;
      const name = action.pathname.slice(1);
      if (
        name !== "open-app" &&
        name !== "open-usage" &&
        name !== "open-scheduled-tasks" &&
        name !== "open-usage-settings"
      )
        return;
      closePanel();
      void runPromise(desktopWindow.dispatchMenuAction(name).pipe(Effect.ignore));
    });
    loadPanel(window);
  };

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: SET_MENU_BAR_SUMMARY_CHANNEL,
      payload: DesktopMenuBarSummarySchema,
      result: Schema.Void,
      handler: (next) =>
        Effect.sync(() => {
          if (platform !== "darwin") return;
          summary = next;
          if (tray === null || tray.isDestroyed()) {
            tray = new Electron.Tray(Electron.nativeImage.createEmpty());
            tray.setTitle("T3 Code");
            tray.setToolTip("T3 Code usage and reset times");
            tray.on("click", togglePanel);
            tray.on("right-click", togglePanel);
          }
          if (panel !== null && !panel.isDestroyed()) {
            const bounds = panelBounds();
            if (bounds) panel.setBounds(bounds);
            loadPanel(panel);
          }
        }),
    }),
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closePanel();
      if (tray !== null && !tray.isDestroyed()) tray.destroy();
      tray = null;
    }),
  );
});
