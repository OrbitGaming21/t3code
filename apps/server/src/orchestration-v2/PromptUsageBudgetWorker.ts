import { CommandId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as PromptUsageBudget from "../usage/PromptUsageBudget.ts";
import * as Orchestrator from "./Orchestrator.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const budget = yield* PromptUsageBudget.PromptUsageBudget;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register(
      "prompt-usage-budget",
      budget.poll.pipe(
        Effect.flatMap((exceeded) =>
          Effect.forEach(
            exceeded,
            (item) =>
              orchestrator
                .dispatch({
                  type: "run.interrupt",
                  commandId: CommandId.make(`prompt-budget:${item.runId}`),
                  threadId: item.threadId,
                  runId: item.runId,
                  reason: item.reason,
                  holdQueue: true,
                })
                .pipe(
                  Effect.andThen(budget.end(item.runId)),
                  Effect.catchCause((cause) =>
                    Effect.logWarning("Could not stop a prompt at its subscription budget", {
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
