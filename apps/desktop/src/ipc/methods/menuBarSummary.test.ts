import * as Effect from "effect/Effect";
import { beforeEach, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";

const native = vi.hoisted(() => ({
  setTitle: vi.fn(),
  setContextMenu: vi.fn(),
  destroy: vi.fn(),
  Tray: vi.fn(),
  buildFromTemplate: vi.fn((template: unknown) => template),
}));
vi.mock("electron", () => ({
  Tray: native.Tray,
  Menu: { buildFromTemplate: native.buildFromTemplate },
  nativeImage: { createEmpty: () => ({}) },
}));

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { installMenuBarSummary } from "./menuBarSummary.ts";

beforeEach(() => {
  vi.clearAllMocks();
  native.Tray.mockImplementation(function (this: object) {
    Object.assign(this, {
      setTitle: native.setTitle,
      setContextMenu: native.setContextMenu,
      destroy: native.destroy,
      isDestroyed: () => false,
    });
  });
});

const run = (
  platform: NodeJS.Platform,
  use: (handler: DesktopIpc.DesktopIpcHandleListener) => unknown,
) => {
  const handlers = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
  return Effect.scoped(
    Effect.gen(function* () {
      yield* installMenuBarSummary();
      yield* Effect.promise(async () => use(handlers.get("desktop:set-menu-bar-summary")!));
    }),
  ).pipe(
    Effect.provideService(HostProcess.Platform, platform),
    Effect.provideService(ElectronWindow.ElectronWindow, {
      main: Effect.succeedNone,
      reveal: () => Effect.void,
    } as never),
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

it.effect("shows the summary under a T3 Code menu bar title and removes it on disposal", () =>
  Effect.gen(function* () {
    const event = { sender: { id: 1 } };
    yield* run("darwin", (handler) => {
      void handler(event, { lines: ["Tokens today: 1.2K"] });
      void handler(event, { lines: ["Tokens today: 2.4K"] });
    });
    expect(native.Tray).toHaveBeenCalledTimes(1);
    expect(native.setTitle).toHaveBeenCalledWith("T3 Code");
    expect(native.buildFromTemplate).toHaveBeenLastCalledWith([
      { label: "Tokens today: 2.4K", enabled: false },
      { type: "separator" },
      { label: "Open T3 Code", click: expect.any(Function) },
    ]);
    expect(native.destroy).toHaveBeenCalledTimes(1);
  }),
);

it.effect("ignores the summary outside macOS and rejects oversized input", () =>
  Effect.gen(function* () {
    const event = { sender: { id: 1 } };
    yield* run("linux", (handler) => {
      void handler(event, { lines: ["Tokens today: 1.2K"] });
    });
    expect(native.Tray).not.toHaveBeenCalled();
    yield* run("darwin", (handler) => {
      return expect(
        handler(event, { lines: Array.from({ length: 25 }, () => "x") }),
      ).rejects.toBeDefined();
    });
  }),
);
