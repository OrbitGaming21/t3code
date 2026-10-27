import { ConnectedAppId, ConnectedAppListResult, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ConnectedApps from "../../../connectedApps/ConnectedApps.ts";
import { AppTools } from "../../../connectedApps/ConnectedAppClient.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    ConnectedApps.ConnectedApps,
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};
export const ConnectedAppsToolkit = Toolkit.make(
  Tool.make("connected_apps_list", {
    ...shared,
    description:
      "List apps the user has connected in Settings, Integrations. Connect and sign in there before using app tools.",
    success: ConnectedAppListResult,
  }).annotate(Tool.Readonly, true),
  Tool.make("connected_app_tools", {
    ...shared,
    description:
      "Discover a connected app's tools, descriptions, and input schemas before calling one.",
    parameters: Schema.Struct({ id: ConnectedAppId }),
    success: AppTools,
  }).annotate(Tool.Readonly, true),
  Tool.make("connected_app_call", {
    ...shared,
    description:
      "Call a tool on a connected app on the user's behalf. Follow its input schema and the user's instructions. External actions can be irreversible; only perform actions the user requested.",
    parameters: Schema.Struct({
      id: ConnectedAppId,
      name: Schema.String,
      arguments: Schema.Record(Schema.String, Schema.Unknown),
    }),
    success: Schema.Unknown,
  }),
);
