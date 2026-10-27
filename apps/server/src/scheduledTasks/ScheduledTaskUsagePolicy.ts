import * as Schema from "effect/Schema";
import { ScheduledTaskError, type ScheduledTask } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";

const isScheduledTaskError = Schema.is(ScheduledTaskError);

export class ScheduledTaskUsagePolicy extends Context.Service<
  ScheduledTaskUsagePolicy,
  { readonly check: (task: ScheduledTask) => Effect.Effect<void, ScheduledTaskError> }
>()("t3/scheduledTasks/ScheduledTaskUsagePolicy") {}

export const layer = Layer.effect(
  ScheduledTaskUsagePolicy,
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    const providers = yield* ProviderRegistry.ProviderRegistry;
    const threads = yield* ThreadManagementService.ThreadManagementService;
    return {
      check: Effect.fn("ScheduledTaskUsagePolicy.check")(
        function* (task: ScheduledTask) {
          const ceiling = (yield* settings.getSettings).scheduledTaskUsageCeilingPercent;
          if (ceiling === null) return;
          const reject = (message: string) => new ScheduledTaskError({ taskId: task.id, message });
          if (ceiling === 0)
            return yield* reject("Scheduled tasks are paused by the 0% usage ceiling.");
          const instanceId =
            task.threadId === null
              ? task.modelSelection.instanceId
              : (yield* threads.getProjectThread({
                  projectId: task.projectId,
                  threadId: task.threadId,
                })).thread.modelSelection.instanceId;
          const provider = (yield* providers.refreshInstance(instanceId)).find(
            (item) => item.instanceId === instanceId,
          );
          const limits = provider?.usageLimits;
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          if (
            !limits ||
            limits.unavailable ||
            limits.windows.length === 0 ||
            now - Date.parse(limits.checkedAt) > 5 * 60_000 ||
            limits.windows.some(
              (window) => window.resetsAt !== undefined && Date.parse(window.resetsAt) <= now,
            )
          ) {
            return yield* reject(
              "Scheduled task held: fresh provider usage limits are unavailable. Disable the usage ceiling to allow runs without limits.",
            );
          }
          const exceeded = limits.windows.find((window) => window.usedPercent >= ceiling);
          if (exceeded)
            return yield* reject(
              `Scheduled task held: ${exceeded.label} usage is ${exceeded.usedPercent}%, at or above your ${ceiling}% ceiling.`,
            );
        },
        Effect.mapError((cause) =>
          isScheduledTaskError(cause)
            ? cause
            : new ScheduledTaskError({
                message: "Could not check the scheduled task usage ceiling.",
                cause,
              }),
        ),
      ),
    };
  }),
);
