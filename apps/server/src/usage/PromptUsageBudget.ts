import {
  type ProviderInstanceId,
  type RunId,
  type ThreadId,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as Settings from "../serverSettings.ts";

type Window = {
  readonly id: string;
  readonly resetsAt: string | undefined;
  readonly lastUsed: number;
  readonly spent: number;
};
type Budget = {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly instanceId: ProviderInstanceId;
  readonly percent: number;
  readonly fingerprint: string | undefined;
  readonly windows: readonly Window[];
};
export class PromptUsageBudgetError extends Schema.TaggedError<PromptUsageBudgetError>()(
  "PromptUsageBudgetError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}
export class PromptUsageBudget extends Context.Service<
  PromptUsageBudget,
  {
    readonly begin: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId;
      readonly instanceId: ProviderInstanceId;
    }) => Effect.Effect<void, PromptUsageBudgetError>;
    readonly end: (runId: RunId) => Effect.Effect<void>;
    readonly poll: Effect.Effect<
      readonly { readonly threadId: ThreadId; readonly runId: RunId; readonly reason: string }[]
    >;
  }
>()("t3/usage/PromptUsageBudget") {}

const make = Effect.gen(function* () {
  const settings = yield* Settings.ServerSettingsService;
  const providers = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const budgets = yield* Ref.make<ReadonlyMap<RunId, Budget>>(new Map());
  const nextPollAt = yield* Ref.make(0);
  const lock = yield* Semaphore.make(1);
  const end = (runId: RunId) =>
    Ref.update(budgets, (current) => {
      const next = new Map(current);
      next.delete(runId);
      return next;
    });
  return PromptUsageBudget.of({
    begin: Effect.fn("PromptUsageBudget.begin")(
      function* (input) {
        const current = yield* settings.getSettings;
        const override = current.promptUsageBudgetByThread[input.threadId];
        const percent =
          override === undefined ? current.promptUsageBudgetPercent : override.percent;
        if (percent === null) return;
        const instance = yield* providers.getInstance(input.instanceId);
        const provider = instance === undefined ? undefined : yield* instance.snapshot.refresh;
        if (
          provider?.driver === "codex" &&
          provider.auth.status === "authenticated" &&
          (provider.auth.type === "apiKey" || provider.auth.type === "apikey")
        )
          return;
        if (percent === 0)
          return yield* new PromptUsageBudgetError({
            message:
              "The per-prompt subscription budget is 0%. Raise it or disable it before sending a prompt.",
          });
        const limits = provider?.usageLimits;
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        if (!validLimits(limits, now))
          return yield* new PromptUsageBudgetError({
            message:
              "Cannot start this prompt without fresh subscription usage limits. Disable the per-prompt budget to use an unmetered provider.",
          });
        yield* Ref.update(budgets, (current) =>
          new Map(current).set(input.runId, {
            ...input,
            percent,
            fingerprint: limits.credentialFingerprint,
            windows: limits.windows.map((window) => ({
              id: window.id,
              resetsAt: window.resetsAt,
              lastUsed: window.usedPercent,
              spent: 0,
            })),
          }),
        );
      },
      Effect.mapError((cause) =>
        isBudgetError(cause)
          ? cause
          : new PromptUsageBudgetError({
              message: "Could not check the per-prompt subscription budget.",
              cause,
            }),
      ),
    ),
    end,
    poll: Effect.gen(function* () {
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      if (now < (yield* Ref.get(nextPollAt))) return [];
      const active = [...(yield* Ref.get(budgets)).values()];
      if (active.length === 0) return [];
      yield* Ref.set(nextPollAt, now + 30_000);
      const snapshots = new Map<ProviderInstanceId, ServerProviderUsageLimits | undefined>();
      for (const id of new Set(active.map((item) => item.instanceId))) {
        const instance = yield* providers.getInstance(id);
        snapshots.set(
          id,
          instance === undefined ? undefined : (yield* instance.snapshot.refresh).usageLimits,
        );
      }
      const exceeded: { threadId: ThreadId; runId: RunId; reason: string }[] = [];
      for (const budget of active) {
        if (!(yield* Ref.get(budgets)).has(budget.runId)) continue;
        const limits = snapshots.get(budget.instanceId);
        let reason: string | null = null;
        let windows = budget.windows;
        if (!validLimits(limits, now) || limits.credentialFingerprint !== budget.fingerprint)
          reason =
            "Prompt stopped because its subscription usage budget can no longer be measured.";
        else {
          windows = budget.windows.map((previous) => {
            const current = limits.windows.find((window) => window.id === previous.id);
            if (!current) return previous;
            const reset =
              current.resetsAt !== previous.resetsAt && current.usedPercent < previous.lastUsed;
            const spent =
              previous.spent +
              (reset ? current.usedPercent : Math.max(0, current.usedPercent - previous.lastUsed));
            return {
              id: previous.id,
              resetsAt: current.resetsAt,
              lastUsed: current.usedPercent,
              spent,
            };
          });
          if (
            budget.windows.some(
              (previous) => !limits.windows.some((window) => window.id === previous.id),
            )
          )
            reason = "Prompt stopped because its subscription quota window is unavailable.";
          else if (windows.some((window) => window.spent >= budget.percent))
            reason = `Prompt stopped after reported subscription usage increased by ${budget.percent}% of a quota window, reaching its per-prompt budget. Concurrent account usage may contribute.`;
        }
        if (reason) {
          exceeded.push({ threadId: budget.threadId, runId: budget.runId, reason });
        } else
          yield* Ref.update(budgets, (current) =>
            current.has(budget.runId)
              ? new Map(current).set(budget.runId, { ...budget, windows })
              : current,
          );
      }
      return exceeded;
    }).pipe(lock.withPermits(1)),
  });
});

const isBudgetError = Schema.is(PromptUsageBudgetError);
function validLimits(
  limits: ServerProviderUsageLimits | undefined,
  now: number,
): limits is ServerProviderUsageLimits {
  return (
    limits !== undefined &&
    !limits.unavailable &&
    limits.windows.length > 0 &&
    now - Date.parse(limits.checkedAt) <= 5 * 60_000 &&
    limits.windows.every((window) => !window.resetsAt || Date.parse(window.resetsAt) > now)
  );
}
export const layer = Layer.effect(PromptUsageBudget, make);
