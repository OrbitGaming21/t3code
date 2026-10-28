import {
  CONNECTED_APP_CATALOG,
  ConnectedAppConnectResult,
  ConnectedAppId,
  ConnectedAppListResult,
  ConnectedAppSignInInput,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
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
      "List apps the user has connected. Use `connected_app_connect` when the user asks to log into an app.",
    success: ConnectedAppListResult,
  }).annotate(Tool.Readonly, true),
  Tool.make("connected_app_connect", {
    ...shared,
    description:
      "Start signing the user into a catalog app: GitHub, Gmail, Notion, Linear, Jira & Confluence, Sentry, Stripe, Vercel, Cloudflare, Hugging Face. GitHub and Gmail require one-time OAuth app setup in Settings → Integrations. Give the user the returned `authorizationUrl` as a link to open; once they finish, the app's tools are available. Null URL: already signed in.",
    parameters: Schema.Struct({
      origin: ConnectedAppSignInInput.fields.origin.annotate({
        description:
          "Origin of the T3 server the user's browser can reach, for the OAuth callback. Never substitute localhost for a remote environment.",
      }),
      app: Schema.Literals(CONNECTED_APP_CATALOG.map((entry) => entry.id)).annotate({
        description: "Catalog id.",
      }),
    }),
    success: ConnectedAppConnectResult,
  }).annotate(Tool.Destructive, false),
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
