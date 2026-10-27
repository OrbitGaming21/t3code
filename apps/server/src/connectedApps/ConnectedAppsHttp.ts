import { CONNECTED_APP_OAUTH_CALLBACK_PATH } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as ConnectedApps from "./ConnectedApps.ts";

export const layer = HttpRouter.add(
  "GET",
  CONNECTED_APP_OAUTH_CALLBACK_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const apps = yield* ConnectedApps.ConnectedApps;
    const query = new URL(request.url, "http://localhost").searchParams;
    const state = query.get("state");
    const code = query.get("code");
    const result =
      state && code && !query.has("error")
        ? yield* apps.finishSignIn({ state, code }).pipe(Effect.result)
        : null;
    const success = result?._tag === "Success";
    return HttpServerResponse.html(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>T3 Code app connection</title></head><body><h1>${success ? "App connected" : "Could not connect the app"}</h1><p>${success ? "Return to T3 Code and refresh your connected apps. You can close this tab." : "Return to Settings, Integrations in T3 Code and try signing in again."}</p></body></html>`,
    ).pipe(
      HttpServerResponse.setStatus(success ? 200 : 400),
      HttpServerResponse.setHeaders({
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      }),
    );
  }),
);
