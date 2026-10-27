import { expect, it } from "@effect/vitest";
import { CommandId, RunId, ThreadId, type OrchestrationV2ServerCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as PromptUsageBudget from "../usage/PromptUsageBudget.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as PromptUsageBudgetWorker from "./PromptUsageBudgetWorker.ts";

it.effect("interrupts the budgeted run, holds its queue, and acknowledges the stop", () =>
  Effect.gen(function* () {
    const commands = yield* Ref.make<readonly OrchestrationV2ServerCommand[]>([]);
    const ended = yield* Ref.make<readonly RunId[]>([]);
    const runId = RunId.make("run:budgeted");
    const threadId = ThreadId.make("thread:budgeted");
    yield* Layer.build(
      PromptUsageBudgetWorker.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(PromptUsageBudget.PromptUsageBudget)({
              poll: Effect.succeed([{ runId, threadId, reason: "Prompt budget reached." }]),
              end: (id) => Ref.update(ended, (items) => [...items, id]),
            }),
            Layer.mock(Orchestrator.OrchestratorV2)({
              dispatch: (command) =>
                Ref.update(commands, (items) => [...items, command]).pipe(
                  Effect.as({ sequence: 1, storedEvents: [] }),
                ),
            }),
            Layer.mock(Scheduler.Scheduler)({
              register: (_name, sweep) => sweep.pipe(Effect.orDie, Effect.asVoid),
            }),
          ),
        ),
      ),
    );
    expect(yield* Ref.get(commands)).toEqual([
      {
        type: "run.interrupt",
        commandId: CommandId.make(`prompt-budget:${runId}`),
        runId,
        threadId,
        reason: "Prompt budget reached.",
        holdQueue: true,
      },
    ]);
    expect(yield* Ref.get(ended)).toEqual([runId]);
  }),
);
