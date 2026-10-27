import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { SET_MENU_BAR_SUMMARY_CHANNEL } from "../channels.ts";

const MenuBarSummary = Schema.Struct({
  lines: Schema.Array(Schema.String.check(Schema.isMaxLength(200))).check(Schema.isMaxLength(24)),
});

export const installMenuBarSummary = Effect.fn("desktop.ipc.installMenuBarSummary")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const platform = yield* HostProcess.Platform;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let tray: Electron.Tray | null = null;

  const open = () => {
    void runPromise(
      electronWindow.main.pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: (window) => electronWindow.reveal(window),
          }),
        ),
      ),
    );
  };

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: SET_MENU_BAR_SUMMARY_CHANNEL,
      payload: MenuBarSummary,
      result: Schema.Void,
      handler: ({ lines }) =>
        Effect.sync(() => {
          if (platform !== "darwin") return;
          if (tray === null || tray.isDestroyed()) {
            tray = new Electron.Tray(Electron.nativeImage.createEmpty());
            tray.setTitle("T3 Code");
          }
          tray.setContextMenu(
            Electron.Menu.buildFromTemplate([
              ...lines.map((label) => ({ label, enabled: false })),
              { type: "separator" },
              { label: "Open T3 Code", click: open },
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
