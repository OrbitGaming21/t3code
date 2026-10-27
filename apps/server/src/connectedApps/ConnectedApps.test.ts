import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { ConnectedAppError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ConnectedAppClient from "./ConnectedAppClient.ts";
import * as ConnectedApps from "./ConnectedApps.ts";

const fixture = Effect.fn("ConnectedAppsTest.fixture")(function* (failExchange = false) {
  const bytes = yield* Ref.make<Uint8Array | undefined>(undefined);
  const requests = yield* Ref.make<
    readonly { app: ConnectedAppClient.StoredApp; operation: ConnectedAppClient.AppOperation }[]
  >([]);
  const dependencies = Layer.mergeAll(
    NodeCrypto.layer,
    Layer.mock(ServerSecretStore.ServerSecretStore)({
      get: () => Ref.get(bytes).pipe(Effect.map(Option.fromNullishOr)),
      set: (_name, value) => Ref.set(bytes, value),
    }),
    Layer.succeed(ConnectedAppClient.ConnectedAppClient, {
      run: (app, operation) =>
        Effect.gen(function* () {
          yield* Ref.update(requests, (items) => [...items, { app, operation }]);
          if (operation.type === "signIn")
            return {
              app: { ...app, verifier: "private-verifier", client: { client_id: "test" } },
              authorizationUrl: `https://example.com/authorize?state=${app.state}`,
              result: null,
            };
          if (operation.type === "call" && operation.arguments.fail === true)
            return {
              app: { ...app, tokens: { access_token: "rotated-token", token_type: "bearer" } },
              authorizationUrl: null,
              result: null,
              error: new ConnectedAppError({
                message: "Remote tool failed after refreshing credentials.",
              }),
            };
          if (operation.type === "finish" && failExchange)
            return yield* new ConnectedAppError({ message: "Exchange failed." });
          return {
            app: {
              ...app,
              status: "connected" as const,
              tokens: { access_token: "private-token", token_type: "bearer" },
            },
            authorizationUrl: null,
            result:
              operation.type === "tools"
                ? {
                    tools: [
                      {
                        name: "find_notes",
                        description: "Find notes",
                        inputSchema: { type: "object" },
                      },
                    ],
                  }
                : operation.type === "call"
                  ? { content: [{ type: "text", text: "Found a note" }] }
                  : null,
          };
        }),
    }),
  );
  const layer = ConnectedApps.layer.pipe(Layer.provide(dependencies));
  const services = yield* Layer.build(layer);
  return { apps: Context.get(services, ConnectedApps.ConnectedApps), bytes, requests, layer };
});

it.effect("persists app connections across service restarts and removes saved credentials", () =>
  Effect.gen(function* () {
    const { apps, layer } = yield* fixture();
    const app = yield* apps.add({ name: "Notes", url: "https://example.com/mcp" });
    const restarted = Context.get(
      yield* Layer.build(Layer.fresh(layer)),
      ConnectedApps.ConnectedApps,
    );
    expect((yield* restarted.list).apps).toEqual([app]);
    yield* restarted.remove(app.id);
    expect((yield* apps.list).apps).toEqual([]);
    expect((yield* apps.tools(app.id).pipe(Effect.flip)).message).toBe("Connected app not found.");
  }),
);

it.effect("completes sign-in, redacts credentials from app listings, and calls app tools", () =>
  Effect.gen(function* () {
    const { apps, requests } = yield* fixture();
    const app = yield* apps.add({ name: "Notes", url: "https://example.com/mcp" });
    const signIn = yield* apps.signIn({ id: app.id, origin: "https://my-t3.example" });
    const state = new URL(signIn.authorizationUrl!).searchParams.get("state")!;
    yield* apps.finishSignIn({ state, code: "test-code" });
    const listed = yield* apps.list;
    expect(listed.apps[0]?.status).toBe("connected");
    expect(JSON.stringify(listed)).not.toContain("private-");
    const completed = (yield* Ref.get(requests)).find((item) => item.operation.type === "finish");
    expect(completed?.app.redirectUrl).toBe("https://my-t3.example/oauth/apps/callback");
    expect(completed?.app.verifier).toBe("private-verifier");
    expect((yield* apps.tools(app.id)).tools[0]?.name).toBe("find_notes");
    expect(yield* apps.callTool(app.id, "find_notes", { query: "work" })).toEqual({
      content: [{ type: "text", text: "Found a note" }],
    });
    expect((yield* Ref.get(requests)).at(-1)?.operation).toEqual({
      type: "call",
      name: "find_notes",
      arguments: { query: "work" },
    });
    expect(
      (yield* apps.finishSignIn({ state, code: "replay" }).pipe(Effect.flip)).message,
    ).toContain("expired or was already used");
  }),
);

it.effect("expires sign-in requests and replaces a previous pending sign-in", () =>
  Effect.gen(function* () {
    const { apps } = yield* fixture();
    const app = yield* apps.add({ name: "Notes", url: "https://example.com/mcp" });
    const first = yield* apps.signIn({ id: app.id, origin: "http://localhost:3000" });
    const second = yield* apps.signIn({ id: app.id, origin: "http://localhost:3000" });
    const stateOf = (url: string | null) => new URL(url!).searchParams.get("state")!;
    expect(
      (yield* apps
        .finishSignIn({ state: stateOf(first.authorizationUrl), code: "old" })
        .pipe(Effect.flip)).message,
    ).toContain("expired");
    yield* TestClock.adjust("11 minutes");
    expect(
      (yield* apps
        .finishSignIn({ state: stateOf(second.authorizationUrl), code: "late" })
        .pipe(Effect.flip)).message,
    ).toContain("expired");
  }),
);

it.effect("consumes state even when token exchange fails", () =>
  Effect.gen(function* () {
    const { apps, requests } = yield* fixture(true);
    const app = yield* apps.add({ name: "Notes", url: "https://example.com/mcp" });
    const signIn = yield* apps.signIn({ id: app.id, origin: "https://my-t3.example" });
    const state = new URL(signIn.authorizationUrl!).searchParams.get("state")!;
    yield* apps.finishSignIn({ state, code: "test" }).pipe(Effect.flip);
    yield* apps.finishSignIn({ state, code: "test" }).pipe(Effect.flip);
    expect(
      (yield* Ref.get(requests)).filter((item) => item.operation.type === "finish"),
    ).toHaveLength(1);
  }),
);

it.effect("rejects duplicate and unsafe URLs without altering connections", () =>
  Effect.gen(function* () {
    const { apps } = yield* fixture();
    yield* apps.add({ name: "Notes", url: "https://example.com/mcp" });
    yield* apps.add({ name: "Duplicate", url: "https://example.com/mcp" }).pipe(Effect.flip);
    for (const url of [
      "file:///etc/passwd",
      "http://example.com/mcp",
      "https://user:password@example.com/mcp",
      "not a url",
    ]) {
      yield* apps.add({ name: "Invalid", url }).pipe(Effect.flip);
    }
    expect((yield* apps.list).apps).toHaveLength(1);
    yield* apps.add({ name: "Local", url: "http://127.0.0.1:3001/mcp" });
  }),
);

it.effect("keeps rotated credentials when a remote operation fails", () =>
  Effect.gen(function* () {
    const { apps, requests } = yield* fixture();
    const app = yield* apps.add({ name: "Notes", url: "https://example.com/mcp" });
    yield* apps.callTool(app.id, "find_notes", { fail: true }).pipe(Effect.asVoid, Effect.flip);
    yield* apps.tools(app.id);
    expect((yield* Ref.get(requests)).at(-1)?.app.tokens).toEqual({
      access_token: "rotated-token",
      token_type: "bearer",
    });
  }),
);
