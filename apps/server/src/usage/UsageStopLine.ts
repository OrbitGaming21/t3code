import {
  type ProviderInstanceId,
  type RunId,
  type ServerProvider,
  type ServerProviderUsageWindow,
  type ThreadId,
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

type Watched = {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly instanceId: ProviderInstanceId;
};
export class UsageStopLineError extends Schema.TaggedError<UsageStopLineError>()(
  "UsageStopLineError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

/** Stops prompts once a provider's reported subscription usage reaches the stop line. */
export class UsageStopLine extends Context.Service<
  UsageStopLine,
  {
    readonly begin: (input: Watched) => Effect.Effect<void, UsageStopLineError>;
    readonly end: (runId: RunId) => Effect.Effect<void>;
    readonly poll: Effect.Effect<
      readonly { readonly threadId: ThreadId; readonly runId: RunId; readonly reason: string }[]
    >;
  }
>()("t3/usage/UsageStopLine") {}

const POLL_INTERVAL_MS = 30_000;

const make = Effect.gen(function* () {
  const settings = yield* Settings.ServerSettingsService;
  const providers = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const watched = yield* Ref.make<ReadonlyMap<RunId, Watched & { readonly line: number }>>(
    new Map(),
  );
  const nextPollAt = yield* Ref.make(0);
  const lock = yield* Semaphore.make(1);

  const lineFor = (threadId: ThreadId) =>
    settings.getSettings.pipe(
      Effect.map((current) => {
        const override = current.promptUsageBudgetByThread[threadId];
        return override === undefined ? current.promptUsageBudgetPercent : override.percent;
      }),
    );
  const refreshProvider = (instanceId: ProviderInstanceId) =>
    providers
      .getInstance(instanceId)
      .pipe(
        Effect.flatMap((instance) =>
          instance === undefined ? Effect.undefined : instance.snapshot.refresh,
        ),
      );
  const end = (runId: RunId) =>
    Ref.update(watched, (current) => {
      const next = new Map(current);
      next.delete(runId);
      return next;
    });

  return UsageStopLine.of({
    begin: Effect.fn("UsageStopLine.begin")(
      function* (input) {
        const line = yield* lineFor(input.threadId);
        if (line === null) return;
        const provider = yield* refreshProvider(input.instanceId);
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const reached = reachedWindow(provider, line, now);
        if (reached) {
          return yield* new UsageStopLineError({
            message: `${reachedMessage(reached, line, now)} Raise the stop line, or turn it off for this chat, to keep going.`,
          });
        }
        yield* Ref.update(watched, (current) =>
          new Map(current).set(input.runId, { ...input, line }),
        );
      },
      Effect.mapError((cause) =>
        isStopLineError(cause)
          ? cause
          : new UsageStopLineError({ message: "Could not check your usage stop line.", cause }),
      ),
    ),
    end,
    poll: Effect.gen(function* () {
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      if (now < (yield* Ref.get(nextPollAt))) return [];
      const active = [...(yield* Ref.get(watched)).values()];
      if (active.length === 0) return [];
      yield* Ref.set(nextPollAt, now + POLL_INTERVAL_MS);
      const snapshots = new Map<ProviderInstanceId, ServerProvider | undefined>();
      for (const id of new Set(active.map((item) => item.instanceId))) {
        snapshots.set(id, yield* refreshProvider(id));
      }
      const stillWatched = yield* Ref.get(watched);
      return active.flatMap((item) => {
        if (!stillWatched.has(item.runId)) return [];
        const reached = reachedWindow(snapshots.get(item.instanceId), item.line, now);
        return reached
          ? [
              {
                threadId: item.threadId,
                runId: item.runId,
                reason: reachedMessage(reached, item.line, now),
              },
            ]
          : [];
      });
    }).pipe(lock.withPermits(1)),
  });
});

const isStopLineError = Schema.is(UsageStopLineError);

/** Unknown or expired usage never blocks: providers without subscription limits keep working. */
function reachedWindow(
  provider: ServerProvider | undefined,
  line: number,
  now: number,
): ServerProviderUsageWindow | undefined {
  const limits = provider?.usageLimits;
  if (!limits || limits.unavailable) return undefined;
  return limits.windows
    .filter((window) => !window.resetsAt || Date.parse(window.resetsAt) > now)
    .toSorted((a, b) => b.usedPercent - a.usedPercent)
    .find((window) => window.usedPercent >= line);
}

function reachedMessage(window: ServerProviderUsageWindow, line: number, now: number): string {
  const resets = window.resetsAt
    ? ` It resets in ${untilReset(Date.parse(window.resetsAt) - now)}.`
    : "";
  return `Stopped at your usage stop line: ${window.label} usage is ${Math.round(window.usedPercent)}%, at or above ${line}%.${resets}`;
}

function untilReset(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export const layer = Layer.effect(UsageStopLine, make);
