import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Path the app's OAuth server redirects back to; dev proxies `/oauth`. */
export const CONNECTED_APP_OAUTH_CALLBACK_PATH = "/oauth/apps/callback";

export const ConnectedAppId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
);
export type ConnectedAppId = typeof ConnectedAppId.Type;

export const ConnectedAppStatus = Schema.Literals(["connected", "needs_sign_in"]);
export type ConnectedAppStatus = typeof ConnectedAppStatus.Type;

export const ConnectedApp = Schema.Struct({
  id: ConnectedAppId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
  status: ConnectedAppStatus,
  oauthConfigured: Schema.optionalKey(Schema.Boolean),
});
export type ConnectedApp = typeof ConnectedApp.Type;

export const ConnectedAppListResult = Schema.Struct({ apps: Schema.Array(ConnectedApp) });
export type ConnectedAppListResult = typeof ConnectedAppListResult.Type;

export const ConnectedAppAddInput = Schema.Struct({
  name: ConnectedApp.fields.name,
  url: ConnectedApp.fields.url,
  oauthClient: Schema.optionalKey(
    Schema.Struct({
      clientId: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
      clientSecret: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(4096))),
    }),
  ),
});
export type ConnectedAppAddInput = typeof ConnectedAppAddInput.Type;

export const ConnectedAppRemoveInput = Schema.Struct({ id: ConnectedAppId });
export type ConnectedAppRemoveInput = typeof ConnectedAppRemoveInput.Type;

export const ConnectedAppSignInInput = Schema.Struct({
  id: ConnectedAppId,
  /** Reachable HTTP base address, including any proxy prefix, for the OAuth return. */
  origin: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
});
export type ConnectedAppSignInInput = typeof ConnectedAppSignInInput.Type;

export const ConnectedAppSignInResult = Schema.Struct({
  /** Null when the app is already signed in or needs no sign-in. */
  authorizationUrl: Schema.NullOr(Schema.String),
});
export type ConnectedAppSignInResult = typeof ConnectedAppSignInResult.Type;

export class ConnectedAppError extends Schema.TaggedError<ConnectedAppError>()(
  "ConnectedAppError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface ConnectedAppCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly oauthSetupUrl?: string;
}

export const CONNECTED_APP_CATALOG = [
  {
    id: "github",
    name: "GitHub",
    description: "Work with repositories, issues, and pull requests.",
    url: "https://api.githubcopilot.com/mcp/",
    oauthSetupUrl: "https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Search mail, read threads, and prepare drafts. Google preview access required.",
    url: "https://gmailmcp.googleapis.com/mcp/v1",
    oauthSetupUrl: "https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Search, read, and edit pages and databases.",
    url: "https://mcp.notion.com/mcp",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Find, create, and update issues and projects.",
    url: "https://mcp.linear.app/mcp",
  },
  {
    id: "atlassian",
    name: "Jira & Confluence",
    description: "Work with Jira issues and Confluence pages.",
    url: "https://mcp.atlassian.com/v1/mcp",
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Look up errors, issues, and releases.",
    url: "https://mcp.sentry.dev/mcp",
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Look up customers, payments, and subscriptions.",
    url: "https://mcp.stripe.com",
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Check projects, deployments, and logs.",
    url: "https://mcp.vercel.com",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    description: "Deploy and manage Workers, Pages, DNS, R2, and other Cloudflare services.",
    url: "https://mcp.cloudflare.com/mcp",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    description: "Search models, datasets, and Spaces.",
    url: "https://huggingface.co/mcp",
  },
] as const satisfies readonly ConnectedAppCatalogEntry[];

export const ConnectedAppConnectResult = Schema.Struct({
  app: ConnectedApp,
  /** Show this to the user; null when the app is already signed in. */
  authorizationUrl: Schema.NullOr(Schema.String),
});
export type ConnectedAppConnectResult = typeof ConnectedAppConnectResult.Type;

export function connectedAppCallbackUrl(base: string): string | null {
  try {
    const url = new URL(base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return new URL(`.${CONNECTED_APP_OAUTH_CALLBACK_PATH}`, url).href;
  } catch {
    return null;
  }
}
