import { DEFAULT_USAGE_DISPLAY_SETTINGS } from "@t3tools/contracts";
import * as NodeEvents from "node:events";
import * as Effect from "effect/Effect";
import { beforeEach, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";

const native = vi.hoisted(() => ({
  Tray: vi.fn(),
  BrowserWindow: vi.fn(),
  getDisplayMatching: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("electron", () => ({
  Tray: native.Tray,
  BrowserWindow: native.BrowserWindow,
  screen: { getDisplayMatching: native.getDisplayMatching },
  nativeImage: { createEmpty: () => ({}) },
}));

import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { installMenuBarSummary } from "./menuBarSummary.ts";

beforeEach(() => vi.clearAllMocks());

function setup() {
  const tray = Object.assign(new NodeEvents.EventEmitter(), {
    setTitle: vi.fn(),
    setToolTip: vi.fn(),
    getBounds: () => ({ x: 1410, y: 0, width: 70, height: 24 }),
    isDestroyed: () => false,
    destroy: vi.fn(),
  });
  const windows: ReturnType<typeof makeWindow>[] = [];
  function makeWindow() {
    let destroyed = false;
    const window = Object.assign(new NodeEvents.EventEmitter(), {
      webContents: Object.assign(new NodeEvents.EventEmitter(), { setWindowOpenHandler: vi.fn() }),
      loadURL: vi.fn((_url: string) => Promise.resolve()),
      setBounds: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isDestroyed: () => destroyed,
      destroy: vi.fn(() => {
        destroyed = true;
        window.emit("closed");
      }),
    });
    return window;
  }
  native.Tray.mockImplementation(function () {
    return tray;
  });
  native.BrowserWindow.mockImplementation(function () {
    const window = makeWindow();
    windows.push(window);
    return window;
  });
  native.getDisplayMatching.mockReturnValue({
    workArea: { x: 0, y: 25, width: 1440, height: 875 },
  });
  native.dispatch.mockImplementation(() => Effect.void);
  return { tray, windows };
}

const run = (
  platform: NodeJS.Platform,
  use: (handler: DesktopIpc.DesktopIpcHandleListener) => Promise<void>,
) => {
  const handlers = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
  return Effect.scoped(
    Effect.gen(function* () {
      yield* installMenuBarSummary();
      yield* Effect.promise(() => use(handlers.get("desktop:set-menu-bar-summary")!));
    }),
  ).pipe(
    Effect.provideService(HostProcess.Platform, platform),
    Effect.provideService(
      DesktopWindow.DesktopWindow,
      DesktopWindow.DesktopWindow.of({
        dispatchMenuAction: native.dispatch,
      } as unknown as DesktopWindow.DesktopWindow["Service"]),
    ),
    Effect.provide(
      DesktopIpc.layer({
        handle: (channel, handler) => {
          handlers.set(channel, handler);
        },
        removeHandler: (channel) => {
          handlers.delete(channel);
        },
        on: vi.fn(),
        removeAllListeners: vi.fn(),
      }),
    ),
  );
};

const event = { sender: { id: 1 } };

it.effect("shows project progress before usage and keeps the expanded panel on screen", () =>
  Effect.gen(function* () {
    const { tray, windows } = setup();
    yield* run("darwin", async (handler) => {
      await handler(event, {
        projects: [
          {
            name: "<Project>",
            status: "working",
            label: "2 agents working",
            duration: "For 12m",
            detail: "Building & testing",
          },
        ],
        items: [{ label: "Codex quota", usedPercent: 20, action: "open-usage" }],
      });
      tray.emit("click");
      const html = decodeURIComponent(
        windows[0]!.loadURL.mock.lastCall![0]!.split(",").slice(1).join(","),
      );
      expect(html.indexOf('aria-label="Project progress"')).toBeLessThan(
        html.indexOf('<section class="quotas">'),
      );
      expect(html).toContain("&lt;Project&gt;");
      expect(html).toContain("Building &amp; testing");
      expect(html).toContain("For 12m");
      const [bounds] = native.BrowserWindow.mock.lastCall!;
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
    });
  }),
);

it.effect("opens a bounded panel from the tray, updates it, and releases it on disposal", () =>
  Effect.gen(function* () {
    const { tray, windows } = setup();
    yield* run("darwin", async (handler) => {
      await handler(event, {
        items: [
          {
            label: "Codex · 5-hour",
            usedPercent: 23,
            reset: "Resets in 2h 10m",
            action: "open-usage",
          },
          {
            label: "Codex · Weekly",
            usedPercent: 64,
            reset: "Resets in 3d 4h",
            action: "open-usage",
          },
        ],
      });
      expect(native.BrowserWindow).not.toHaveBeenCalled();
      tray.emit("click");
      const window = windows[0]!;
      const [bounds] = native.BrowserWindow.mock.lastCall!;
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(1440);
      expect(bounds.y).toBeGreaterThanOrEqual(25);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
      expect(window.show).not.toHaveBeenCalled();
      window.emit("ready-to-show");
      expect(window.show).toHaveBeenCalledOnce();
      await handler(event, {
        display: { ...DEFAULT_USAGE_DISPLAY_SETTINGS, menuSize: "large" },
        items: [{ label: "Tokens today", value: "1.2K", action: "open-usage" }],
      });
      expect(window.loadURL).toHaveBeenCalledTimes(2);
      expect(window.setBounds).toHaveBeenCalledWith(expect.objectContaining({ width: 360 }));
    });
    expect(native.Tray).toHaveBeenCalledOnce();
    expect(tray.setTitle).toHaveBeenCalledWith("T3 Code");
    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(windows[0]!.isDestroyed()).toBe(true);
  }),
);

it.effect(
  "toggles closed and dismisses on Escape or outside focus without dispatching an action",
  () =>
    Effect.gen(function* () {
      const { tray, windows } = setup();
      yield* run("darwin", async (handler) => {
        await handler(event, { items: [] });
        tray.emit("click");
        tray.emit("click");
        expect(windows[0]!.isDestroyed()).toBe(true);
        tray.emit("click");
        const preventDefault = vi.fn();
        windows[1]!.webContents.emit("before-input-event", { preventDefault }, { key: "Escape" });
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(windows[1]!.isDestroyed()).toBe(true);
        tray.emit("click");
        windows[2]!.emit("blur");
        expect(windows[2]!.isDestroyed()).toBe(true);
        expect(native.dispatch).not.toHaveBeenCalled();
      });
    }),
);

it.effect(
  "keeps navigation inside the panel restricted to app actions and escapes provider labels",
  () =>
    Effect.gen(function* () {
      const { tray, windows } = setup();
      yield* run("darwin", async (handler) => {
        await handler(event, {
          environmentLabel: '<img src="https://external.invalid">',
          items: [{ label: "<script>alert(1)</script>", action: "open-usage" }],
        });
        tray.emit("click");
        const window = windows[0]!;
        const html = decodeURIComponent(
          window.loadURL.mock.lastCall![0]!.split(",").slice(1).join(","),
        );
        expect(html).not.toContain('<img src="https://external.invalid">');
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        const preventDefault = vi.fn();
        window.webContents.emit(
          "will-navigate",
          { preventDefault },
          "https://external.invalid/open-usage",
        );
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(window.isDestroyed()).toBe(false);
        expect(native.dispatch).not.toHaveBeenCalled();
        window.webContents.emit(
          "will-navigate",
          { preventDefault },
          "https://t3-menu.invalid/open-usage-settings",
        );
        expect(window.isDestroyed()).toBe(true);
        expect(native.dispatch).toHaveBeenCalledWith("open-usage-settings");
      });
    }),
);

it.effect(
  "ignores the summary outside macOS and rejects invalid progress and oversized input",
  () =>
    Effect.gen(function* () {
      setup();
      yield* run("linux", async (handler) => {
        await handler(event, { items: [{ label: "Tokens today", action: "open-usage" }] });
      });
      expect(native.Tray).not.toHaveBeenCalled();
      yield* run("darwin", async (handler) => {
        await expect(
          handler(event, {
            items: Array.from({ length: 25 }, () => ({ label: "x", action: "open-usage" })),
          }),
        ).rejects.toBeDefined();
        await expect(
          handler(event, { items: [{ label: "5-hour", usedPercent: -1, action: "open-usage" }] }),
        ).rejects.toBeDefined();
      });
    }),
);
