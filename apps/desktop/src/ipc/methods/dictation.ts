// @effect-diagnostics nodeBuiltinImport:off -- Owns a long-lived streaming helper process whose events are pushed to the renderer.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { DesktopDictationEvent } from "@t3tools/contracts";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import {
  DICTATION_EVENT_CHANNEL,
  DICTATION_START_CHANNEL,
  DICTATION_STOP_CHANNEL,
} from "../channels.ts";

let active: NodeChildProcess.ChildProcess | null = null;

export function parseDictationLine(line: string): DesktopDictationEvent | null {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null || !("type" in value)) return null;
    const text = "text" in value && typeof value.text === "string" ? value.text : "";
    const message = "message" in value && typeof value.message === "string" ? value.message : "";
    switch (value.type) {
      case "ready":
        return { type: "ready" };
      case "partial":
      case "final":
        return { type: value.type, text };
      case "error":
        return { type: "error", message };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export const startDictation = DesktopIpc.makeIpcMethod({
  channel: DICTATION_START_CHANNEL,
  payload: Schema.Struct({ locale: Schema.optional(Schema.String) }),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.dictation.start")(function* ({ locale }, event) {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const sender = event ? Electron.webContents.fromId(event.sender.id) : undefined;
    const send = (message: DesktopDictationEvent) => {
      if (sender && !sender.isDestroyed()) sender.send(DICTATION_EVENT_CHANNEL, message);
    };
    active?.kill();
    active = null;
    const helper = NodePath.join(environment.resourcesPath, "dictation", "t3-dictation");
    if (environment.platform !== "darwin" || !NodeFS.existsSync(helper)) {
      send({ type: "error", message: "Voice input is not available in this build." });
      return;
    }
    const child = NodeChildProcess.spawn(helper, locale ? [locale] : [], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    active = child;
    let settled = false;
    NodeReadline.createInterface({ input: child.stdout }).on("line", (line) => {
      const message = parseDictationLine(line);
      if (!message) return;
      if (message.type === "final" || message.type === "error") settled = true;
      send(message);
    });
    child.on("error", () => {
      settled = true;
      send({ type: "error", message: "Could not start voice input." });
    });
    child.on("exit", () => {
      if (active === child) active = null;
      if (!settled) send({ type: "final", text: "" });
    });
  }),
});

export const stopDictation = DesktopIpc.makeIpcMethod({
  channel: DICTATION_STOP_CHANNEL,
  payload: Schema.Struct({ cancel: Schema.optional(Schema.Boolean) }),
  result: Schema.Void,
  handler: ({ cancel }) =>
    Effect.sync(() => {
      if (!active) return;
      if (cancel) {
        active.kill();
        active = null;
      } else {
        active.stdin?.end("stop\n");
      }
    }),
});
