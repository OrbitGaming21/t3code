import { expect, it } from "vite-plus/test";
import { connectedAppCallbackUrl } from "./connectedApps.ts";

it("returns to the chosen environment, preserving remote proxy prefixes", () => {
  expect(connectedAppCallbackUrl("https://remote.example/proxy/server")).toBe(
    "https://remote.example/proxy/server/oauth/apps/callback",
  );
  expect(connectedAppCallbackUrl("http://localhost:3773")).toBe(
    "http://localhost:3773/oauth/apps/callback",
  );
});

it("rejects callback bases containing credentials, queries, or unsupported schemes", () => {
  for (const base of [
    "file:///tmp",
    "https://name:secret@remote.example",
    "https://remote.example/?token=x",
    "https://remote.example/#x",
    "invalid",
  ])
    expect(connectedAppCallbackUrl(base)).toBeNull();
});
