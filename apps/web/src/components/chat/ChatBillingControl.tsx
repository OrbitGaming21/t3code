import { WalletCardsIcon } from "lucide-react";
import type {
  ChatBillingPreference,
  EnvironmentId,
  ModelSelection,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { persistClientSettingsPatch } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { chatBillingSource, selectChatBillingProvider } from "./chatBilling";

export function ChatBillingControl({
  environmentId,
  providers,
  selected,
  modelSelection,
  disabled,
  onSelect,
  getDisabledReason,
}: {
  environmentId: EnvironmentId;
  providers: readonly ServerProvider[];
  selected: ServerProvider | null;
  modelSelection: ModelSelection;
  disabled: boolean;
  onSelect: (instanceId: ProviderInstanceId, model: string) => void;
  getDisabledReason: (instanceId: ProviderInstanceId, model: string) => string | null;
}) {
  const source = chatBillingSource(selected);
  const label =
    source === "api-credits"
      ? "API credits"
      : source === "subscription"
        ? "Subscription"
        : "Billing";
  const choose = (billing: ChatBillingPreference) => {
    const choice = selectChatBillingProvider(providers, billing, modelSelection);
    if (!choice || disabled || getDisabledReason(choice.instanceId, choice.model)) return;
    onSelect(choice.instanceId, choice.model);
    void persistClientSettingsPatch({ chatBillingPreference: billing });
  };
  return (
    <Popover>
      <PopoverTrigger
        render={<Button size="sm" variant="ghost" aria-label={`Chat billing: ${label}`} />}
      >
        <WalletCardsIcon />
        <span className="hidden md:inline">{label}</span>
      </PopoverTrigger>
      <PopoverPopup width="md" align="start">
        <div className="space-y-4 text-sm">
          <div>
            <h2 className="font-semibold">Chat billing</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose which connected account pays for your next prompt.
            </p>
          </div>
          {(["subscription", "api-credits"] as const).map((billing) => {
            const target = selectChatBillingProvider(providers, billing, modelSelection);
            const reason = target ? getDisabledReason(target.instanceId, target.model) : null;
            return (
              <div key={billing} className="space-y-1">
                <Button
                  size="sm"
                  variant={source === billing ? "secondary" : "outline"}
                  disabled={disabled || !target || reason !== null}
                  onClick={() => choose(billing)}
                >
                  {billing === "subscription" ? "Use ChatGPT subscription" : "Use API credits"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {reason ??
                    (!target
                      ? billing === "subscription"
                        ? "Connect a ChatGPT account in Providers first."
                        : "Connect a Codex instance signed in with an API key first."
                      : billing === "subscription"
                        ? "Uses your included plan allowance. Provider limits apply."
                        : "Billed to your OpenAI API account at API rates.")}
                </p>
              </div>
            );
          })}
          {source === null ? (
            <p className="text-xs text-muted-foreground">
              The selected provider’s account determines its billing.
            </p>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            render={<Link to="/settings/providers" search={{ environmentId }} />}
          >
            Manage accounts
          </Button>
          <p className="text-xs text-muted-foreground">
            You can save unlimited chats here. Subscription limits still apply; paid API usage is
            never an automatic fallback.
          </p>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
