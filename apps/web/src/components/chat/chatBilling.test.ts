import { expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { chatBillingSource, selectChatBillingProvider } from "./chatBilling";

function provider(id: string, type: string): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(id),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    status: "ready",
    version: null,
    auth: { status: "authenticated", type },
    checkedAt: "2026-10-27T12:00:00.000Z",
    models: [
      {
        slug: "default-model",
        name: "Default",
        isDefault: true,
        isCustom: false,
        capabilities: null,
      },
      { slug: "selected-model", name: "Selected", isCustom: false, capabilities: null },
    ],
    skills: [],
    slashCommands: [],
  };
}

it("uses actual account authentication to identify billing", () => {
  expect(chatBillingSource(provider("plan", "chatgpt"))).toBe("subscription");
  expect(chatBillingSource(provider("paid", "apiKey"))).toBe("api-credits");
  expect(
    chatBillingSource({ ...provider("unknown", "unknown"), auth: { status: "unknown" } }),
  ).toBeNull();
  expect(
    chatBillingSource({
      ...provider("other", "apiKey"),
      driver: ProviderDriverKind.make("claudeAgent"),
    }),
  ).toBeNull();
});

it("switches accounts while preserving a supported model", () => {
  const plan = provider("plan", "chatgpt");
  const paid = provider("paid", "apiKey");
  expect(
    selectChatBillingProvider([plan, paid], "api-credits", {
      instanceId: plan.instanceId,
      model: "selected-model",
    }),
  ).toEqual({ instanceId: paid.instanceId, model: "selected-model" });
  expect(selectChatBillingProvider([plan, paid], "subscription")).toEqual({
    instanceId: plan.instanceId,
    model: "default-model",
  });
});

it("never falls back to paid accounts when a subscription is unavailable", () => {
  const paid = provider("paid", "apiKey");
  expect(selectChatBillingProvider([paid], "subscription")).toBeNull();
  expect(
    selectChatBillingProvider(
      [{ ...provider("plan", "chatgpt"), enabled: false }, paid],
      "subscription",
    ),
  ).toBeNull();
});
