import { expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ScheduledTask,
  ThreadId,
  type OrchestrationV2ThreadProjection,
  type ServerProvider,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ScheduledTaskUsagePolicy from "./ScheduledTaskUsagePolicy.ts";

const now = "2026-10-26T12:00:00.000Z";
const task = Schema.decodeSync(ScheduledTask)({
  id: "task:usage",
  title: "Review",
  prompt: "Review changes",
  enabled: true,
  schedule: { type: "interval", everyMs: 60_000 },
  projectId: "project:test",
  threadId: null,
  workspaceStrategy: { type: "root" },
  modelSelection: { instanceId: "codex", model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: now,
  updatedAt: now,
  nextRunAt: now,
  lastRunAt: null,
  lastRunStatus: "never",
  lastRunError: null,
  runCount: 0,
});
const limits: ServerProviderUsageLimits = {
  checkedAt: now,
  windows: [
    {
      id: "session",
      label: "Session",
      kind: "session",
      usedPercent: 40,
      resetsAt: "2026-10-26T15:00:00.000Z",
    },
  ],
};
function provider(usageLimits?: ServerProviderUsageLimits): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: now,
    models: [],
    slashCommands: [],
    skills: [],
    ...(usageLimits ? { usageLimits } : {}),
  };
}
function setup(ceiling: number | null, usageLimits?: ServerProviderUsageLimits) {
  return ScheduledTaskUsagePolicy.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ServerSettings.layerTest({ scheduledTaskUsageCeilingPercent: ceiling }),
        Layer.mock(ProviderRegistry.ProviderRegistry)({
          refreshInstance: () => Effect.succeed([provider(usageLimits)]),
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      ),
    ),
  );
}

it.effect("allows unmetered providers when the ceiling is disabled", () =>
  Effect.gen(function* () {
    const policy = yield* ScheduledTaskUsagePolicy.ScheduledTaskUsagePolicy;
    yield* policy.check(task);
  }).pipe(Effect.provide(setup(null))),
);

it.effect("holds every scheduled run at zero without probing the provider", () =>
  Effect.gen(function* () {
    const policy = yield* ScheduledTaskUsagePolicy.ScheduledTaskUsagePolicy;
    const error = yield* policy.check(task).pipe(Effect.flip);
    expect(error.message).toContain("0% usage ceiling");
  }).pipe(Effect.provide(setup(0))),
);

it.effect("allows usage below the ceiling and honors saved changes", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(now));
    const settings = yield* ServerSettings.ServerSettingsService;
    const policy = yield* ScheduledTaskUsagePolicy.ScheduledTaskUsagePolicy;
    yield* policy.check(task);
    yield* settings.updateSettings({ scheduledTaskUsageCeilingPercent: 40 });
    expect((yield* policy.check(task).pipe(Effect.flip)).message).toContain(
      "at or above your 40% ceiling",
    );
    yield* settings.updateSettings({ scheduledTaskUsageCeilingPercent: null });
    yield* policy.check(task);
  }).pipe(
    Effect.provide(
      ScheduledTaskUsagePolicy.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            ServerSettings.layerTest({ scheduledTaskUsageCeilingPercent: 50 }),
            Layer.mock(ProviderRegistry.ProviderRegistry)({
              refreshInstance: () => Effect.succeed([provider(limits)]),
            }),
            Layer.mock(ThreadManagementService.ThreadManagementService)({}),
          ),
        ),
      ),
    ),
  ),
);

it.effect.each([
  ["missing", undefined],
  ["empty", { ...limits, windows: [] }],
  ["failed probe", { ...limits, unavailable: { reason: "probeFailed" as const } }],
  ["stale", { ...limits, checkedAt: "2026-10-26T11:00:00.000Z" }],
  ["expired window", { ...limits, windows: [{ ...limits.windows[0]!, resetsAt: now }] }],
] as const)("holds a run with %s limits", ([_name, snapshot]) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(now));
    const policy = yield* ScheduledTaskUsagePolicy.ScheduledTaskUsagePolicy;
    expect((yield* policy.check(task).pipe(Effect.flip)).message).toContain(
      "fresh provider usage limits are unavailable",
    );
  }).pipe(Effect.provide(setup(80, snapshot))),
);

it.effect("checks every quota window", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(now));
    const policy = yield* ScheduledTaskUsagePolicy.ScheduledTaskUsagePolicy;
    expect((yield* policy.check(task).pipe(Effect.flip)).message).toContain("Weekly usage is 90%");
  }).pipe(
    Effect.provide(
      setup(80, {
        ...limits,
        windows: [
          ...limits.windows,
          { id: "weekly", label: "Weekly", kind: "weekly", usedPercent: 90 },
        ],
      }),
    ),
  ),
);

it.effect("uses the bound thread's current provider instead of the task's original selection", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(now));
    const currentInstanceId = ProviderInstanceId.make("claude");
    const policyLayer = ScheduledTaskUsagePolicy.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ServerSettings.layerTest({ scheduledTaskUsageCeilingPercent: 30 }),
          Layer.mock(ProviderRegistry.ProviderRegistry)({
            refreshInstance: (instanceId) => {
              expect(instanceId).toBe(currentInstanceId);
              return Effect.succeed([{ ...provider(limits), instanceId: currentInstanceId }]);
            },
          }),
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getProjectThread: () =>
              Effect.succeed({
                thread: { modelSelection: { instanceId: currentInstanceId, model: "sonnet" } },
              } as OrchestrationV2ThreadProjection),
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const policy = yield* ScheduledTaskUsagePolicy.ScheduledTaskUsagePolicy;
      const error = yield* policy
        .check({ ...task, threadId: ThreadId.make("thread:existing") })
        .pipe(Effect.flip);
      expect(error.message).toContain("at or above your 30% ceiling");
    }).pipe(Effect.provide(policyLayer));
  }),
);
