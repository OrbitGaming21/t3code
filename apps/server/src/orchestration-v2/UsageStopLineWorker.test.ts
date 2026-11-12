import { expect, it } from "@effect/vitest";
import { CommandId, RunId, ThreadId, type OrchestrationV2ServerCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as UsageStopLine from "../usage/UsageStopLine.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as UsageStopLineWorker from "./UsageStopLineWorker.ts";

it.effect("interrupts a run past the stop line, holds its queue, and acknowledges the stop", () =>
  Effect.gen(function* () {
    const commands = yield* Ref.make<readonly OrchestrationV2ServerCommand[]>([]);
    const ended = yield* Ref.make<readonly RunId[]>([]);
    const runId = RunId.make("run:stopped");
    const threadId = ThreadId.make("thread:stopped");
    yield* Layer.build(
      UsageStopLineWorker.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(UsageStopLine.UsageStopLine)({
              poll: Effect.succeed([{ runId, threadId, reason: "Stop line reached." }]),
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
        commandId: CommandId.make(`usage-stop-line:${runId}`),
        runId,
        threadId,
        reason: "Stop line reached.",
        holdQueue: true,
      },
    ]);
    expect(yield* Ref.get(ended)).toEqual([runId]);
  }),
);
