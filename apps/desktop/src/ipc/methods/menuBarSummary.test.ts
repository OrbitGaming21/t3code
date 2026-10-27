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
  dispatched: [] as string[],
}));
vi.mock("electron", () => ({
  Tray: native.Tray,
  Menu: { buildFromTemplate: native.buildFromTemplate },
  nativeImage: { createEmpty: () => ({}) },
}));

import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { installMenuBarSummary } from "./menuBarSummary.ts";

beforeEach(() => {
  vi.clearAllMocks();
  native.dispatched.length = 0;
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
    Effect.provideService(
      DesktopWindow.DesktopWindow,
      DesktopWindow.DesktopWindow.of({
        dispatchMenuAction: (action: string) => Effect.sync(() => native.dispatched.push(action)),
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

it.effect("shows the summary under a T3 Code menu bar title and removes it on disposal", () =>
  Effect.gen(function* () {
    const event = { sender: { id: 1 } };
    yield* run("darwin", (handler) => {
      void handler(event, { items: [{ label: "Tokens today: 1.2K", action: "open-usage" }] });
      void handler(event, {
        items: [{ label: "Scheduled: 1 active", action: "open-scheduled-tasks" }],
      });
    });
    expect(native.Tray).toHaveBeenCalledTimes(1);
    expect(native.setTitle).toHaveBeenCalledWith("T3 Code");
    const [items] = native.buildFromTemplate.mock.lastCall as [
      { label?: string; click?: () => void }[],
    ];
    expect(items.map((item) => item.label)).toEqual([
      "Scheduled: 1 active",
      undefined,
      "Open T3 Code",
    ]);
    items[0]!.click!();
    items[2]!.click!();
    expect(native.dispatched).toEqual(["open-scheduled-tasks", "open-app"]);
    expect(native.destroy).toHaveBeenCalledTimes(1);
  }),
);

it.effect("ignores the summary outside macOS and rejects oversized input", () =>
  Effect.gen(function* () {
    const event = { sender: { id: 1 } };
    yield* run("linux", (handler) => {
      void handler(event, { items: [{ label: "Tokens today: 1.2K", action: "open-usage" }] });
    });
    expect(native.Tray).not.toHaveBeenCalled();
    yield* run("darwin", (handler) => {
      return expect(
        handler(event, {
          items: Array.from({ length: 25 }, () => ({ label: "x", action: "open-usage" })),
        }),
      ).rejects.toBeDefined();
    });
  }),
);
