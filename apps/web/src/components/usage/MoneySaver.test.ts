import { UsageDay } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { moneySaved, subscriptionComparison, subscriptionPeriodDays } from "./MoneySaver";

describe("moneySaved", () => {
  it("spreads the monthly price over the shown period", () => {
    expect(moneySaved(50, 20, 30)).toEqual({ planCostUsd: 20, savedUsd: 30 });
    expect(moneySaved(1, 30, 7)).toEqual({ planCostUsd: 7, savedUsd: -6 });
  });
});

it("excludes unused providers and missing prices from savings", () => {
  expect(subscriptionComparison([], "codex", 20, 7).savedUsd).toBeNull();
  const unpriced = [{ provider: "codex" as const, costUsd: 10, records: 2, unpricedRecords: 1 }];
  expect(subscriptionComparison(unpriced, "codex", 20, 7).savedUsd).toBeNull();
  expect(subscriptionComparison(unpriced, "claude", 20, 7).records).toBe(0);
  expect(
    subscriptionComparison([{ ...unpriced[0]!, unpricedRecords: 0 }], "codex", 30, 7).savedUsd,
  ).toBe(3);
});

it("compares the period actually displayed, including rolling 24-hour views", () => {
  expect(
    subscriptionPeriodDays({
      timeZone: "America/New_York",
      sinceDay: UsageDay.make("2026-10-21"),
      untilDay: UsageDay.make("2026-10-27"),
    }),
  ).toBe(7);
  expect(
    subscriptionPeriodDays({
      timeZone: "America/New_York",
      sinceDay: UsageDay.make("2026-10-26"),
      untilDay: UsageDay.make("2026-10-27"),
      sinceTime: "2026-10-26T12:00:00.000Z",
      untilTime: "2026-10-27T12:00:00.000Z",
    }),
  ).toBe(1);
});
