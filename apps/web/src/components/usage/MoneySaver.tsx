import type { UsageProviderKind, UsageSummaryInput } from "@t3tools/contracts";
import type { MergedUsage, ModelTotals } from "@t3tools/shared/usageMerge";
import { enumerateDays, formatUsd } from "@t3tools/shared/usageFormat";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";
import { Input } from "../ui/input";
import { PROVIDER_PRESENTATION } from "./usageProviders";

const STORAGE_KEY = "t3code:usage-subscription-prices:v1";
const Price = Schema.Number.check(
  Schema.makeFilter(
    (value) => (Number.isFinite(value) && value >= 0) || "Enter a nonnegative price.",
  ),
);
const Prices = Schema.Struct({ codex: Price, claude: Price });
type Prices = typeof Prices.Type;
const DEFAULT_PRICES: Prices = { codex: 20, claude: 20 };
const PROVIDERS = ["codex", "claude"] as const satisfies readonly UsageProviderKind[];

function readPrices(): Prices {
  try {
    return getLocalStorageItem(STORAGE_KEY, Prices) ?? DEFAULT_PRICES;
  } catch {
    return DEFAULT_PRICES;
  }
}

export function moneySaved(apiCostUsd: number, monthlyPriceUsd: number, days: number) {
  const planCostUsd = (monthlyPriceUsd * days) / 30;
  return { planCostUsd, savedUsd: apiCostUsd - planCostUsd };
}

export function subscriptionPeriodDays(window: UsageSummaryInput) {
  return window.sinceTime && window.untilTime
    ? Math.max(0, Date.parse(window.untilTime) - Date.parse(window.sinceTime)) / 86_400_000
    : enumerateDays(window.sinceDay, window.untilDay).length;
}

export function subscriptionComparison(
  models: readonly Pick<ModelTotals, "provider" | "costUsd" | "records" | "unpricedRecords">[],
  provider: UsageProviderKind,
  monthlyPrice: number,
  days: number,
) {
  const usage = models.filter((model) => model.provider === provider);
  const apiCostUsd = usage.reduce((sum, model) => sum + model.costUsd, 0);
  const records = usage.reduce((sum, model) => sum + model.records, 0);
  const unpriced = usage.some((model) => model.unpricedRecords > 0);
  const result = moneySaved(apiCostUsd, monthlyPrice, days);
  return {
    apiCostUsd,
    planCostUsd: result.planCostUsd,
    savedUsd: records > 0 && !unpriced ? result.savedUsd : null,
    unpriced,
    records,
  };
}

export function MoneySaver({ merged, days }: { merged: MergedUsage; days: number }) {
  const [prices, setPrices] = useState(readPrices);
  const savePrice = (provider: keyof Prices, input: HTMLInputElement) => {
    const price = Number(input.value);
    if (!Number.isFinite(price) || price < 0 || input.value.trim() === "") {
      input.value = String(prices[provider]);
      return;
    }
    const next = { ...prices, [provider]: price };
    setPrices(next);
    setLocalStorageItem(STORAGE_KEY, next, Prices);
  };
  const rows = PROVIDERS.map((provider) => ({
    provider,
    ...subscriptionComparison(merged.models, provider, prices[provider], days),
  }));
  const available = rows.filter((row) => row.savedUsd !== null);
  const totalSaved = available.reduce((sum, row) => sum + (row.savedUsd ?? 0), 0);
  return (
    <section aria-label="Money saver" className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Money saver</h2>
        <p className="text-xs text-muted-foreground">Selected period · API-price comparison</p>
      </div>
      <p
        className={
          available.length > 0 && totalSaved >= 0
            ? "text-2xl font-semibold tabular-nums text-success"
            : "text-2xl font-semibold tabular-nums"
        }
      >
        {available.length === 0
          ? "No complete estimate yet"
          : totalSaved >= 0
            ? `${formatUsd(totalSaved)} potential savings`
            : `${formatUsd(-totalSaved)} subscription share above API value`}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.provider} className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{PROVIDER_PRESENTATION[row.provider].label}</span>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                $
                <span className="w-16">
                  <Input
                    size="sm"
                    type="number"
                    min={0}
                    step={1}
                    aria-label={`${PROVIDER_PRESENTATION[row.provider].label} subscription per month`}
                    defaultValue={prices[row.provider]}
                    onBlur={(event) => savePrice(row.provider, event.currentTarget)}
                  />
                </span>
                /mo assumed
              </label>
            </div>
            <p className="flex justify-between gap-2 text-muted-foreground">
              <span>Token value at API prices</span>
              <span className="tabular-nums">
                {row.records === 0
                  ? "No usage"
                  : `${row.unpriced ? "≥" : "≈"}${formatUsd(row.apiCostUsd)}`}
              </span>
            </p>
            <p className="flex justify-between gap-2 text-muted-foreground">
              <span>Subscription share</span>
              <span className="tabular-nums">{formatUsd(row.planCostUsd)}</span>
            </p>
            <p className="flex justify-between gap-2 font-medium">
              <span>
                {row.savedUsd !== null && row.savedUsd < 0
                  ? "Above API value"
                  : "Potential savings"}
              </span>
              <span className="tabular-nums">
                {row.savedUsd === null ? "Not estimated" : formatUsd(Math.abs(row.savedUsd))}
              </span>
            </p>
            {row.unpriced ? (
              <p className="text-xs text-muted-foreground">
                Add the missing model prices to calculate a complete comparison.
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Assumes a 30-day month and the prices you enter. This compares usage with subscription
        costs; it is not an invoice. API-paid usage is not additional subscription savings.
        Providers with no usage or missing prices are excluded from the total.
      </p>
    </section>
  );
}
