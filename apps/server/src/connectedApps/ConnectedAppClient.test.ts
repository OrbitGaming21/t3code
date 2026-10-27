// @effect-diagnostics-next-line nodeBuiltinImport:off -- This network fixture exercises the SDK against a real HTTP endpoint.
import * as NodeHttp from "node:http";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ConnectedAppClient from "./ConnectedAppClient.ts";

const decodeRequest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
      method: Schema.String,
    }),
  ),
);
const fixture = Effect.acquireRelease(
  Effect.tryPromise(
    () =>
      new Promise<{ server: NodeHttp.Server; origin: string }>((resolve, reject) => {
        const server = NodeHttp.createServer((request, response) => {
          const origin = `http://${request.headers.host}`;
          const json = (value: unknown, status = 200) => {
            response.writeHead(status, { "content-type": "application/json" });
            response.end(JSON.stringify(value));
          };
          if (request.url === "/.well-known/oauth-protected-resource")
            return json({ resource: `${origin}/mcp`, authorization_servers: [origin] });
          if (request.url === "/.well-known/oauth-authorization-server")
            return json({
              issuer: origin,
              authorization_endpoint: `${origin}/authorize`,
              token_endpoint: `${origin}/token`,
              registration_endpoint: `${origin}/register`,
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
              token_endpoint_auth_methods_supported: ["none"],
            });
          if (request.url === "/register")
            return json(
              {
                client_id: "test-client",
                redirect_uris: ["http://localhost:3000/oauth/apps/callback"],
              },
              201,
            );
          if (request.url === "/token")
            return json({ access_token: "test-access-token", token_type: "Bearer" });
          if (request.headers.authorization !== "Bearer test-access-token") {
            response.setHeader(
              "www-authenticate",
              `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
            );
            return json({ error: "unauthorized" }, 401);
          }
          if (request.method !== "POST") {
            response.writeHead(405);
            response.end();
            return;
          }
          const chunks: Buffer[] = [];
          request.on("data", (chunk: Buffer) => chunks.push(chunk));
          request.on("end", () => {
            const wire = decodeRequest(Buffer.concat(chunks).toString());
            if (wire.id === undefined) {
              response.writeHead(202);
              response.end();
              return;
            }
            const result =
              wire.method === "initialize"
                ? {
                    protocolVersion: "2025-03-26",
                    capabilities: { tools: {} },
                    serverInfo: { name: "test-notes", version: "1.0.0" },
                  }
                : wire.method === "tools/list"
                  ? {
                      tools: [
                        {
                          name: "find_notes",
                          description: "Find notes",
                          inputSchema: { type: "object" },
                        },
                      ],
                    }
                  : { content: [{ type: "text", text: "Found a note" }] };
            json({ jsonrpc: "2.0", id: wire.id, result });
          });
        });
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("Expected a TCP fixture"));
            return;
          }
          resolve({ server, origin: `http://127.0.0.1:${address.port}` });
        });
      }),
  ),
  ({ server }) =>
    Effect.promise(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
);

it.live("discovers OAuth, saves PKCE and credentials, then lists and calls remote MCP tools", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { origin } = yield* fixture;
      const client = yield* ConnectedAppClient.ConnectedAppClient;
      const pending = yield* client.run(
        {
          id: "notes",
          name: "Notes",
          url: `${origin}/mcp`,
          status: "needs_sign_in",
          redirectUrl: "http://localhost:3000/oauth/apps/callback",
          state: "test-state",
        },
        { type: "signIn" },
      );
      const authorization = new URL(pending.authorizationUrl!);
      expect(authorization.searchParams.get("state")).toBe("test-state");
      expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
      expect(pending.app.verifier).toBeTruthy();
      const connected = yield* client.run(pending.app, { type: "finish", code: "test-code" });
      expect(connected.app.status).toBe("connected");
      const tools = yield* client.run(connected.app, { type: "tools" });
      expect(tools.result).toMatchObject({ tools: [{ name: "find_notes" }] });
      const called = yield* client.run(tools.app, {
        type: "call",
        name: "find_notes",
        arguments: {},
      });
      expect(called.result).toMatchObject({ content: [{ type: "text", text: "Found a note" }] });
    }),
  ).pipe(Effect.provide(ConnectedAppClient.layer)),
);
