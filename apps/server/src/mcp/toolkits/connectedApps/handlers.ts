import { CONNECTED_APP_CATALOG } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as ConnectedApps from "../../../connectedApps/ConnectedApps.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller, unavailable } from "../../threadAccess.ts";
import { ConnectedAppsToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(ConnectedAppsToolkit, {
  connected_apps_list: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      yield* readCaller();
      return yield* (yield* ConnectedApps.ConnectedApps).list.pipe(Effect.mapError(unavailable));
    }),
  ),
  connected_app_connect: McpToolAccess.writesEnvironment(({ app, origin }, check) =>
    Effect.gen(function* () {
      yield* check;
      const apps = yield* ConnectedApps.ConnectedApps;
      const entry = CONNECTED_APP_CATALOG.find((candidate) => candidate.id === app)!;
      return yield* apps.connectCatalogApp(entry, origin).pipe(Effect.mapError(unavailable));
    }),
  ),
  connected_app_tools: McpToolAccess.reads(({ id }) =>
    Effect.gen(function* () {
      yield* readCaller();
      return yield* (yield* ConnectedApps.ConnectedApps)
        .tools(id)
        .pipe(Effect.mapError(unavailable));
    }),
  ),
  connected_app_call: McpToolAccess.writesEnvironment(({ id, name, arguments: args }, check) =>
    Effect.gen(function* () {
      yield* check;
      return yield* (yield* ConnectedApps.ConnectedApps)
        .callTool(id, name, args)
        .pipe(Effect.mapError(unavailable));
    }),
  ),
});
