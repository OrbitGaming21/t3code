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
import * as UsageStopLine from "./UsageStopLine.ts";

const now = "2026-10-27T12:00:00.000Z";
const input = {
  threadId: ThreadId.make("thread:stop-line"),
  runId: RunId.make("run:stop-line"),
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
const fixture = Effect.fn("UsageStopLineTest.fixture")(function* (
  percent: number | null = 90,
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
  const context = yield* Layer.build(UsageStopLine.layer.pipe(Layer.provide(dependencies)));
  return { stopLine: Context.get(context, UsageStopLine.UsageStopLine), snapshot, refreshes };
});

const usedAt = (usedPercent: number, window = limits.windows[0]!): ServerProviderUsageLimits => ({
  ...limits,
  windows: [{ ...window, usedPercent }],
});

it.effect("stops a running prompt once account usage reaches the stop line", () =>
  Effect.gen(function* () {
    const { stopLine, snapshot } = yield* fixture();
    yield* stopLine.begin(input);
    yield* Ref.set(snapshot, usedAt(89));
    expect(yield* stopLine.poll).toEqual([]);
    yield* TestClock.adjust("30 seconds");
    yield* Ref.set(snapshot, usedAt(90));
    const stopped = yield* stopLine.poll;
    expect(stopped).toMatchObject([{ runId: input.runId, threadId: input.threadId }]);
    expect(stopped[0]?.reason).toContain("Session usage is 90%");
    yield* stopLine.end(input.runId);
    yield* TestClock.adjust("30 seconds");
    expect(yield* stopLine.poll).toEqual([]);
  }),
);

it.effect("holds new prompts while usage is past the stop line", () =>
  Effect.gen(function* () {
    const { stopLine } = yield* fixture(90, usedAt(95));
    const error = yield* stopLine.begin(input).pipe(Effect.flip);
    expect(error.message).toContain("Session usage is 95%");
    expect(error.message).toContain("It resets in 3h 0m.");
    expect(error.message).toContain("turn it off for this chat");
  }),
);

it.effect("ignores windows that have already reset", () =>
  Effect.gen(function* () {
    const expired = usedAt(99, { ...limits.windows[0]!, resetsAt: "2026-10-27T11:00:00.000Z" });
    const { stopLine } = yield* fixture(90, expired);
    yield* stopLine.begin(input);
  }),
);

it.effect("does not probe without a stop line, and lets a chat override it", () =>
  Effect.gen(function* () {
    const off = yield* fixture(null, usedAt(99));
    yield* off.stopLine.begin(input);
    expect(yield* off.stopLine.poll).toEqual([]);
    expect(yield* Ref.get(off.refreshes)).toBe(0);
    const chatOff = yield* fixture(50, usedAt(99), undefined, {
      [input.threadId]: { percent: null },
    });
    yield* chatOff.stopLine.begin(input);
    const chatLower = yield* fixture(null, usedAt(60), undefined, {
      [input.threadId]: { percent: 50 },
    });
    expect((yield* chatLower.stopLine.begin(input).pipe(Effect.flip)).message).toContain("50%");
  }),
);

it.effect("keeps providers without subscription limits working", () =>
  Effect.gen(function* () {
    for (const initial of [
      { ...limits, windows: [] },
      { ...usedAt(99), unavailable: { reason: "unsupported" as const } },
    ]) {
      const { stopLine } = yield* fixture(1, initial, "apiKey");
      yield* stopLine.begin(input);
      expect(yield* stopLine.poll).toEqual([]);
    }
  }),
);

it.effect("shares one provider check across concurrent prompts", () =>
  Effect.gen(function* () {
    const { stopLine, snapshot, refreshes } = yield* fixture();
    yield* stopLine.begin(input);
    yield* stopLine.begin({ ...input, runId: RunId.make("run:concurrent") });
    yield* Ref.set(snapshot, usedAt(92));
    expect(yield* stopLine.poll).toHaveLength(2);
    expect(yield* Ref.get(refreshes)).toBe(3);
    expect(yield* stopLine.poll).toEqual([]);
    expect(yield* Ref.get(refreshes)).toBe(3);
  }),
);
