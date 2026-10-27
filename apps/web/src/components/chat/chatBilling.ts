import type { ChatBillingPreference, ModelSelection, ServerProvider } from "@t3tools/contracts";

export function chatBillingSource(
  provider: ServerProvider | null | undefined,
): ChatBillingPreference | null {
  if (provider?.driver !== "codex" || provider.auth.status !== "authenticated") return null;
  if (provider.auth.type === "apiKey" || provider.auth.type === "apikey") return "api-credits";
  if (provider.auth.type === "chatgpt" || provider.auth.subscriptionSharing === true)
    return "subscription";
  return null;
}

export function selectChatBillingProvider(
  providers: readonly ServerProvider[],
  billing: ChatBillingPreference,
  current?: ModelSelection,
) {
  const candidates = providers.filter(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      provider.status === "ready" &&
      chatBillingSource(provider) === billing,
  );
  const provider =
    candidates.find((entry) => entry.instanceId === current?.instanceId) ?? candidates[0];
  const model =
    provider?.models.find((entry) => entry.slug === current?.model) ??
    provider?.models.find((entry) => entry.isDefault) ??
    provider?.models[0];
  return provider && model ? { instanceId: provider.instanceId, model: model.slug } : null;
}
