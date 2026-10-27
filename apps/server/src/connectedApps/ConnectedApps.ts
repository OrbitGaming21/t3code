import {
  CONNECTED_APP_OAUTH_CALLBACK_PATH,
  ConnectedApp,
  ConnectedAppError,
  type ConnectedAppAddInput,
  type ConnectedAppSignInInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ConnectedAppClient from "./ConnectedAppClient.ts";

const decodeTools = Schema.decodeUnknownEffect(ConnectedAppClient.AppTools);
const Apps = Schema.Array(ConnectedAppClient.StoredApp);
const decodeApps = Schema.decodeUnknownSync(Schema.fromJsonString(Apps));
const encodeApps = Schema.encodeSync(Schema.fromJsonString(Apps));
const publicApp = ({ id, name, url, status }: ConnectedAppClient.StoredApp): ConnectedApp => ({
  id,
  name,
  url,
  status,
});

export class ConnectedApps extends Context.Service<
  ConnectedApps,
  {
    readonly list: Effect.Effect<{ readonly apps: readonly ConnectedApp[] }, ConnectedAppError>;
    readonly add: (input: ConnectedAppAddInput) => Effect.Effect<ConnectedApp, ConnectedAppError>;
    readonly remove: (id: string) => Effect.Effect<void, ConnectedAppError>;
    readonly signIn: (
      input: ConnectedAppSignInInput,
    ) => Effect.Effect<{ readonly authorizationUrl: string | null }, ConnectedAppError>;
    readonly finishSignIn: (input: {
      readonly state: string;
      readonly code: string;
    }) => Effect.Effect<void, ConnectedAppError>;
    readonly tools: (id: string) => Effect.Effect<ConnectedAppClient.AppTools, ConnectedAppError>;
    readonly callTool: (
      id: string,
      name: string,
      args: Record<string, unknown>,
    ) => Effect.Effect<unknown, ConnectedAppError>;
  }
>()("t3/connectedApps/ConnectedApps") {}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const crypto = yield* Crypto.Crypto;
  const client = yield* ConnectedAppClient.ConnectedAppClient;
  const lock = yield* Semaphore.make(1);
  const read = Effect.fn("ConnectedApps.read")(
    function* () {
      const bytes = yield* secrets.get("connected-apps.json");
      return Option.isNone(bytes)
        ? []
        : yield* Effect.try(() => decodeApps(new TextDecoder().decode(bytes.value)));
    },
    Effect.mapError(
      (cause) => new ConnectedAppError({ message: "Could not read connected apps.", cause }),
    ),
  );
  const write = Effect.fn("ConnectedApps.write")(
    (apps: readonly ConnectedAppClient.StoredApp[]) =>
      secrets.set("connected-apps.json", new TextEncoder().encode(encodeApps(apps))),
    Effect.mapError(
      (cause) => new ConnectedAppError({ message: "Could not save connected apps.", cause }),
    ),
  );
  const find = (apps: readonly ConnectedAppClient.StoredApp[], id: string) => {
    const app = apps.find((item) => item.id === id);
    return app
      ? Effect.succeed(app)
      : Effect.fail(new ConnectedAppError({ message: "Connected app not found." }));
  };
  const random = crypto.randomBytes(24).pipe(
    Effect.map((bytes) => Buffer.from(bytes).toString("hex")),
    Effect.mapError(
      (cause) =>
        new ConnectedAppError({ message: "Could not create an app sign-in request.", cause }),
    ),
  );
  const run = Effect.fn("ConnectedApps.run")(function* (
    id: string,
    operation: ConnectedAppClient.AppOperation,
  ) {
    const apps = yield* read();
    const app = yield* find(apps, id);
    const result = yield* client.run(app, operation);
    yield* write(apps.map((item) => (item.id === id ? result.app : item)));
    if (result.error) return yield* result.error;
    return result;
  }, lock.withPermits(1));
  return ConnectedApps.of({
    list: read().pipe(
      Effect.map((apps) => ({ apps: apps.map(publicApp) })),
      lock.withPermits(1),
    ),
    add: Effect.fn("ConnectedApps.add")(function* (input) {
      const url = yield* Effect.try({
        try: () => new URL(input.url),
        catch: (cause) =>
          new ConnectedAppError({ message: "Enter a valid MCP server URL.", cause }),
      });
      if (
        (url.protocol !== "https:" &&
          !(
            url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
          )) ||
        url.username ||
        url.password ||
        url.hash
      ) {
        return yield* new ConnectedAppError({
          message: "Use an HTTPS MCP URL, or HTTP on localhost, without credentials or a fragment.",
        });
      }
      const apps = yield* read();
      if (apps.some((item) => item.url === url.href))
        return yield* new ConnectedAppError({ message: "This app is already connected." });
      if (apps.length >= 32)
        return yield* new ConnectedAppError({
          message: "Remove an app before adding more than 32 connections.",
        });
      const app = {
        id: yield* random,
        name: input.name,
        url: url.href,
        status: "needs_sign_in" as const,
      };
      yield* write([...apps, app]);
      return app;
    }, lock.withPermits(1)),
    remove: Effect.fn("ConnectedApps.remove")(function* (id) {
      const apps = yield* read();
      yield* find(apps, id);
      yield* write(apps.filter((item) => item.id !== id));
    }, lock.withPermits(1)),
    signIn: Effect.fn("ConnectedApps.signIn")(function* (input) {
      const origin = yield* Effect.try({
        try: () => new URL(input.origin),
        catch: (cause) => new ConnectedAppError({ message: "Invalid return address.", cause }),
      });
      if (origin.origin !== input.origin || !["http:", "https:"].includes(origin.protocol))
        return yield* new ConnectedAppError({ message: "Invalid return address." });
      const apps = yield* read();
      const app = yield* find(apps, input.id);
      const prepared = {
        ...app,
        state: yield* random,
        stateExpiresAt: DateTime.toEpochMillis(yield* DateTime.now) + 10 * 60_000,
        redirectUrl: `${origin.origin}${CONNECTED_APP_OAUTH_CALLBACK_PATH}`,
      };
      const result = yield* client.run(prepared, { type: "signIn" });
      yield* write(apps.map((item) => (item.id === app.id ? result.app : item)));
      if (result.error) return yield* result.error;
      return { authorizationUrl: result.authorizationUrl };
    }, lock.withPermits(1)),
    finishSignIn: Effect.fn("ConnectedApps.finishSignIn")(function* (input) {
      const apps = yield* read();
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const app = apps.find(
        (item) => item.state === input.state && (item.stateExpiresAt ?? 0) > now,
      );
      if (!app)
        return yield* new ConnectedAppError({
          message: "This sign-in request expired or was already used. Sign in again from Settings.",
        });
      const consumed = { ...app, state: undefined, stateExpiresAt: undefined };
      yield* write(apps.map((item) => (item.id === app.id ? consumed : item)));
      const result = yield* client.run(consumed, { type: "finish", code: input.code });
      yield* write(
        apps.map((item) =>
          item.id === app.id
            ? { ...result.app, state: undefined, stateExpiresAt: undefined, verifier: undefined }
            : item,
        ),
      );
      if (result.error) return yield* result.error;
    }, lock.withPermits(1)),
    tools: Effect.fn("ConnectedApps.tools")((id) =>
      run(id, { type: "tools" }).pipe(
        Effect.flatMap((result) =>
          decodeTools(result.result).pipe(
            Effect.mapError(
              (cause) => new ConnectedAppError({ message: "Could not list app tools.", cause }),
            ),
          ),
        ),
      ),
    ),
    callTool: Effect.fn("ConnectedApps.callTool")((id, name, args) =>
      run(id, { type: "call", name, arguments: args }).pipe(Effect.map((result) => result.result)),
    ),
  });
});
export const layer = Layer.effect(ConnectedApps, make);
