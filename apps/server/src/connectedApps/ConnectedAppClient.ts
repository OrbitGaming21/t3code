import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { ConnectedApp, ConnectedAppError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export const StoredApp = Schema.Struct({
  ...ConnectedApp.fields,
  client: Schema.optional(Schema.Unknown),
  tokens: Schema.optional(Schema.Unknown),
  verifier: Schema.optional(Schema.String),
  redirectUrl: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
  stateExpiresAt: Schema.optional(Schema.Number),
});
export type StoredApp = typeof StoredApp.Type;

const RemoteTool = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  inputSchema: Schema.Unknown,
});
export const AppTools = Schema.Struct({ tools: Schema.Array(RemoteTool) });
export type AppTools = typeof AppTools.Type;

export type AppOperation =
  | { readonly type: "signIn" }
  | { readonly type: "finish"; readonly code: string }
  | { readonly type: "tools" }
  | { readonly type: "call"; readonly name: string; readonly arguments: Record<string, unknown> };

export class ConnectedAppClient extends Context.Service<
  ConnectedAppClient,
  {
    readonly run: (
      app: StoredApp,
      operation: AppOperation,
    ) => Effect.Effect<
      {
        readonly app: StoredApp;
        readonly authorizationUrl: string | null;
        readonly result: unknown;
        readonly error?: ConnectedAppError;
      },
      ConnectedAppError
    >;
  }
>()("t3/connectedApps/ConnectedAppClient") {}

export const layer = Layer.succeed(ConnectedAppClient, {
  run: Effect.fn("ConnectedAppClient.run")((initial, operation) =>
    Effect.tryPromise({
      try: async (signal) => {
        let app = initial;
        let authorizationUrl: string | null = null;
        const provider: OAuthClientProvider = {
          get redirectUrl() {
            return app.redirectUrl;
          },
          get clientMetadata() {
            return {
              client_name: "T3 Code",
              redirect_uris: app.redirectUrl ? [app.redirectUrl] : [],
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              token_endpoint_auth_method:
                app.client !== undefined &&
                OAuthClientInformationSchema.parse(app.client).client_secret
                  ? "client_secret_post"
                  : "none",
            };
          },
          state: () => {
            if (!app.state) throw new Error("Sign in from T3 Code first.");
            return app.state;
          },
          clientInformation: () =>
            app.client === undefined ? undefined : OAuthClientInformationSchema.parse(app.client),
          saveClientInformation: (client) => {
            app = { ...app, client };
          },
          tokens: () =>
            app.tokens === undefined ? undefined : OAuthTokensSchema.parse(app.tokens),
          saveTokens: (tokens) => {
            app = { ...app, tokens };
          },
          redirectToAuthorization: (url) => {
            if (operation.type !== "signIn")
              throw new Error("Sign in to the app again from Settings.");
            authorizationUrl = url.href;
          },
          saveCodeVerifier: (verifier) => {
            app = { ...app, verifier };
          },
          codeVerifier: () => {
            if (!app.verifier) throw new Error("The sign-in request expired.");
            return app.verifier;
          },
          invalidateCredentials: (scope) => {
            if (scope === "all" || scope === "tokens") app = { ...app, tokens: undefined };
            if (scope === "all" || scope === "client") app = { ...app, client: undefined };
            if (scope === "all" || scope === "verifier") app = { ...app, verifier: undefined };
          },
        };
        const client = new Client({ name: "t3-code", version: "1.0.0" });
        const transport = new StreamableHTTPClientTransport(new URL(app.url), {
          authProvider: provider,
          fetch: (url, init) =>
            // @effect-diagnostics-next-line globalFetch:off -- The MCP SDK requires FetchLike at this adapter boundary.
            fetch(url, {
              ...init,
              signal: AbortSignal.any([
                signal,
                AbortSignal.timeout(30_000),
                ...(init?.signal ? [init.signal] : []),
              ]),
            }),
        });
        try {
          if (operation.type === "finish") await transport.finishAuth(operation.code);
          // The SDK getter permits undefined while its own Transport interface uses an optional string.
          await client.connect(transport as Transport, { signal, timeout: 30_000 });
          app = { ...app, status: "connected" };
          let result: unknown = null;
          if (operation.type === "tools") {
            const tools: AppTools["tools"][number][] = [];
            let cursor: string | undefined;
            do {
              const page = await client.listTools(cursor ? { cursor } : {}, {
                signal,
                timeout: 30_000,
              });
              tools.push(...page.tools);
              cursor = page.nextCursor;
              if (tools.length > 1000) throw new Error("The app returned too many tools.");
            } while (cursor);
            result = { tools };
          } else if (operation.type === "call") {
            result = await client.callTool(
              { name: operation.name, arguments: operation.arguments },
              undefined,
              { signal, timeout: 60_000 },
            );
          }
          return { app, authorizationUrl, result };
        } catch (error) {
          if (
            operation.type === "signIn" &&
            error instanceof UnauthorizedError &&
            authorizationUrl !== null
          ) {
            return {
              app: { ...app, status: "needs_sign_in" as const },
              authorizationUrl,
              result: null,
            };
          }
          return {
            app:
              error instanceof UnauthorizedError
                ? { ...app, status: "needs_sign_in" as const }
                : app,
            authorizationUrl: null,
            result: null,
            error: new ConnectedAppError({
              message: "Could not connect to the app. Check its MCP URL or sign in again.",
              cause: error,
            }),
          };
        } finally {
          await client.close();
        }
      },
      catch: (cause) =>
        new ConnectedAppError({
          message:
            "Could not connect to the app. Check its MCP URL or sign in again. The app must support remote MCP and OAuth dynamic registration, or allow unauthenticated access.",
          cause,
        }),
    }),
  ),
});
