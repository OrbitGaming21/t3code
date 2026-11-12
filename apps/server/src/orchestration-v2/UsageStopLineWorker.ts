import { CommandId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as UsageStopLine from "../usage/UsageStopLine.ts";
import * as Orchestrator from "./Orchestrator.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const stopLine = yield* UsageStopLine.UsageStopLine;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register(
      "usage-stop-line",
      stopLine.poll.pipe(
        Effect.flatMap((exceeded) =>
          Effect.forEach(
            exceeded,
            (item) =>
              orchestrator
                .dispatch({
                  type: "run.interrupt",
                  commandId: CommandId.make(`usage-stop-line:${item.runId}`),
                  threadId: item.threadId,
                  runId: item.runId,
                  reason: item.reason,
                  holdQueue: true,
                })
                .pipe(
                  Effect.andThen(stopLine.end(item.runId)),
                  Effect.catchCause((cause) =>
                    Effect.logWarning("Could not stop a prompt at the usage stop line", {
                      runId: item.runId,
                      cause,
                    }),
                  ),
                ),
            { discard: true },
          ),
        ),
      ),
    );
  }),
);
