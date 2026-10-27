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
});
export type ConnectedApp = typeof ConnectedApp.Type;

export const ConnectedAppListResult = Schema.Struct({ apps: Schema.Array(ConnectedApp) });
export type ConnectedAppListResult = typeof ConnectedAppListResult.Type;

export const ConnectedAppAddInput = Schema.Struct({
  name: ConnectedApp.fields.name,
  url: ConnectedApp.fields.url,
});
export type ConnectedAppAddInput = typeof ConnectedAppAddInput.Type;

export const ConnectedAppRemoveInput = Schema.Struct({ id: ConnectedAppId });
export type ConnectedAppRemoveInput = typeof ConnectedAppRemoveInput.Type;

export const ConnectedAppSignInInput = Schema.Struct({
  id: ConnectedAppId,
  /** Origin the client reached this server on, so the browser can return to it. */
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
