import { expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ServerProvider,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as Settings from "../serverSettings.ts";
import * as PromptUsageBudget from "./PromptUsageBudget.ts";

const now = "2026-10-27T12:00:00.000Z";
const input = {
  threadId: ThreadId.make("thread:budget"),
  runId: RunId.make("run:budget"),
  instanceId: ProviderInstanceId.make("codex"),
};
const limits: ServerProviderUsageLimits = {
  checkedAt: now,
  credentialFingerprint: "account-a",
  windows: [
    {
      id: "session",
      kind: "session",
      label: "Session",
      usedPercent: 20,
      resetsAt: "2026-10-27T15:00:00.000Z",
    },
  ],
};
const fixture = Effect.fn("PromptUsageBudgetTest.fixture")(function* (
  percent: number | null = 5,
  initial: ServerProviderUsageLimits | undefined = limits,
  authType?: string,
  promptUsageBudgetByThread: Record<string, { percent: number | null }> = {},
) {
  yield* TestClock.setTime(Date.parse(now));
  const snapshot = yield* Ref.make(initial);
  const refreshes = yield* Ref.make(0);
  const provider = Ref.get(snapshot).pipe(
    Effect.tap(() => Ref.update(refreshes, (value) => value + 1)),
    Effect.map((usageLimits): ServerProvider => ({
      instanceId: input.instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      status: "ready",
      version: null,
      auth: { status: "authenticated", ...(authType ? { type: authType } : {}) },
      checkedAt: now,
      models: [],
      slashCommands: [],
      skills: [],
      ...(usageLimits ? { usageLimits } : {}),
    })),
  );
  const instance = { snapshot: { refresh: provider } } as ProviderInstance;
  const dependencies = Layer.mergeAll(
    Settings.layerTest({ promptUsageBudgetPercent: percent, promptUsageBudgetByThread }),
    Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
      getInstance: () => Effect.succeed(instance),
    }),
  );
  const context = yield* Layer.build(PromptUsageBudget.layer.pipe(Layer.provide(dependencies)));
  return { budget: Context.get(context, PromptUsageBudget.PromptUsageBudget), snapshot, refreshes };
});

it.effect(
  "measures each prompt from its own starting usage and retries the threshold until interruption is acknowledged",
  () =>
    Effect.gen(function* () {
      const { budget, snapshot } = yield* fixture();
      yield* budget.begin(input);
      yield* Ref.set(snapshot, {
        ...limits,
        windows: [{ ...limits.windows[0]!, usedPercent: 24 }],
      });
      expect(yield* budget.poll).toEqual([]);
      yield* TestClock.adjust("30 seconds");
      yield* Ref.set(snapshot, {
        ...limits,
        windows: [{ ...limits.windows[0]!, usedPercent: 25 }],
      });
      const exceeded = yield* budget.poll;
      expect(exceeded).toMatchObject([{ runId: input.runId, threadId: input.threadId }]);
      expect(exceeded[0]?.reason).toContain("5%");
      yield* TestClock.adjust("30 seconds");
      expect(yield* budget.poll).toHaveLength(1);
      yield* budget.end(input.runId);
      yield* TestClock.adjust("30 seconds");
      expect(yield* budget.poll).toEqual([]);
      yield* budget.begin({ ...input, runId: RunId.make("run:next") });
      expect(yield* budget.poll).toEqual([]);
    }),
);

it.effect("does not probe without a budget, and removes completed prompts", () =>
  Effect.gen(function* () {
    const disabled = yield* fixture(null);
    yield* disabled.budget.begin(input);
    expect(yield* disabled.budget.poll).toEqual([]);
    expect(yield* Ref.get(disabled.refreshes)).toBe(0);
    const enabled = yield* fixture();
    yield* enabled.budget.begin(input);
    yield* enabled.budget.end(input.runId);
    expect(yield* enabled.budget.poll).toEqual([]);
    expect(yield* Ref.get(enabled.refreshes)).toBe(1);
  }),
);

it.effect("uses a chat's own ceiling over the environment ceiling, including turning it off", () =>
  Effect.gen(function* () {
    const chatOff = yield* fixture(0, limits, undefined, { [input.threadId]: { percent: null } });
    yield* chatOff.budget.begin(input);
    expect(yield* Ref.get(chatOff.refreshes)).toBe(0);
    const chatZero = yield* fixture(null, limits, undefined, { [input.threadId]: { percent: 0 } });
    expect((yield* chatZero.budget.begin(input).pipe(Effect.flip)).message).toContain("0%");
  }),
);

it.effect("rejects zero budgets and missing usage before starting a provider turn", () =>
  Effect.gen(function* () {
    const zero = yield* fixture(0);
    expect((yield* zero.budget.begin(input).pipe(Effect.flip)).message).toContain("0%");
    const missing = yield* fixture(5, { ...limits, windows: [] });
    expect((yield* missing.budget.begin(input).pipe(Effect.flip)).message).toContain(
      "fresh subscription usage",
    );
  }),
);

it.effect("stops a prompt when its account changes or its quota reports disappear", () =>
  Effect.gen(function* () {
    const { budget, snapshot } = yield* fixture();
    yield* budget.begin(input);
    yield* Ref.set(snapshot, { ...limits, credentialFingerprint: "different-account" });
    expect((yield* budget.poll)[0]?.reason).toContain("can no longer be measured");
  }),
);

it.effect("retains spending across a quota reset and throttles shared provider probes", () =>
  Effect.gen(function* () {
    const { budget, snapshot, refreshes } = yield* fixture();
    yield* budget.begin(input);
    yield* budget.begin({ ...input, runId: RunId.make("run:concurrent") });
    yield* Ref.set(snapshot, { ...limits, windows: [{ ...limits.windows[0]!, usedPercent: 23 }] });
    expect(yield* budget.poll).toEqual([]);
    expect(yield* Ref.get(refreshes)).toBe(3);
    expect(yield* budget.poll).toEqual([]);
    expect(yield* Ref.get(refreshes)).toBe(3);
    yield* TestClock.adjust("30 seconds");
    yield* Ref.set(snapshot, {
      ...limits,
      windows: [{ ...limits.windows[0]!, usedPercent: 2, resetsAt: "2026-10-27T20:00:00.000Z" }],
    });
    expect(yield* budget.poll).toHaveLength(2);
  }),
);

it.effect("does not apply subscription ceilings to API-billed prompts", () =>
  Effect.gen(function* () {
    for (const percent of [0, 5]) {
      const { budget } = yield* fixture(percent, { ...limits, windows: [] }, "apiKey");
      yield* budget.begin(input);
      expect(yield* budget.poll).toEqual([]);
    }
  }),
);

it.effect("enforces the chat percentage instead of a different environment percentage", () =>
  Effect.gen(function* () {
    const { budget, snapshot } = yield* fixture(2, limits, undefined, {
      [input.threadId]: { percent: 8 },
    });
    yield* budget.begin(input);
    yield* Ref.set(snapshot, { ...limits, windows: [{ ...limits.windows[0]!, usedPercent: 24 }] });
    expect(yield* budget.poll).toEqual([]);
    yield* TestClock.adjust("30 seconds");
    yield* Ref.set(snapshot, { ...limits, windows: [{ ...limits.windows[0]!, usedPercent: 28 }] });
    expect((yield* budget.poll)[0]?.runId).toBe(input.runId);
  }),
);
