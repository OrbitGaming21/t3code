import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { SET_MENU_BAR_SUMMARY_CHANNEL } from "../channels.ts";

const MenuBarSummary = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      label: Schema.String.check(Schema.isMaxLength(200)),
      action: Schema.Literals(["open-usage", "open-scheduled-tasks"]),
    }),
  ).check(Schema.isMaxLength(24)),
});

export const installMenuBarSummary = Effect.fn("desktop.ipc.installMenuBarSummary")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const platform = yield* HostProcess.Platform;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let tray: Electron.Tray | null = null;

  const dispatch = (action: string) => () => {
    void runPromise(desktopWindow.dispatchMenuAction(action).pipe(Effect.ignore));
  };

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: SET_MENU_BAR_SUMMARY_CHANNEL,
      payload: MenuBarSummary,
      result: Schema.Void,
      handler: ({ items }) =>
        Effect.sync(() => {
          if (platform !== "darwin") return;
          if (tray === null || tray.isDestroyed()) {
            tray = new Electron.Tray(Electron.nativeImage.createEmpty());
            tray.setTitle("T3 Code");
          }
          tray.setContextMenu(
            Electron.Menu.buildFromTemplate([
              ...items.map(({ label, action }) => ({ label, click: dispatch(action) })),
              { type: "separator" },
              { label: "Open T3 Code", click: dispatch("open-app") },
            ]),
          );
        }),
    }),
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (tray !== null && !tray.isDestroyed()) tray.destroy();
      tray = null;
    }),
  );
});
