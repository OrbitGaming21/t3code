import { expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, RunId } from "@t3tools/contracts";
import { menuBarProjectDuration, summarizeMenuBarProjects } from "./menuBarProjects";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const projectId = ProjectId.make("project");
const start = "2026-10-27T12:00:00.000Z";
const project = { environmentId: local, id: projectId, title: "T3 Code" };
function thread(overrides: Partial<Parameters<typeof summarizeMenuBarProjects>[1][number]> = {}) {
  return {
    environmentId: local,
    projectId,
    title: "Build the feature",
    archivedAt: null,
    deletedAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestRun: null,
    runtime: {
      status: "running" as const,
      activeRunId: RunId.make("run"),
      activityStartedAt: start,
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: null,
      lastError: null,
      updatedAt: start,
    },
    ...overrides,
  };
}

it("groups projects by environment and counts their active agents", () => {
  const result = summarizeMenuBarProjects(
    [project, { ...project, environmentId: remote }],
    [thread(), thread({ title: "Another agent" })],
    new Set([local, remote]),
  );
  expect(result[0]).toMatchObject({
    name: "T3 Code",
    status: "working",
    label: "2 agents working",
    startedAt: start,
  });
  expect(result[1]).toMatchObject({ environmentId: remote, status: "idle", startedAt: null });
});

it("puts projects needing input first and excludes archived and deleted work", () => {
  const other = ProjectId.make("other");
  const result = summarizeMenuBarProjects(
    [project, { ...project, id: other, title: "Another project" }],
    [
      thread(),
      thread({ projectId: other, hasPendingUserInput: true }),
      thread({ archivedAt: start }),
      thread({ deletedAt: start }),
    ],
    new Set([local]),
  );
  expect(result[0]).toMatchObject({
    name: "Another project",
    status: "attention",
    label: "Waiting for input",
  });
  expect(result[1]?.label).toBe("1 agent working");
});

it("does not present cached work as running when the environment is unavailable", () => {
  const [result] = summarizeMenuBarProjects([project], [thread()], new Set());
  expect(result).toMatchObject({
    status: "offline",
    label: "Unavailable",
    startedAt: null,
    completedAt: null,
  });
});

it("reports the most recent finished run and freezes its duration", () => {
  const completedAt = "2026-10-27T12:12:00.000Z";
  const [result] = summarizeMenuBarProjects(
    [project],
    [
      thread({
        runtime: null,
        latestRun: {
          runId: RunId.make("run"),
          status: "completed",
          requestedAt: start,
          startedAt: start,
          completedAt,
          assistantMessageId: null,
        },
      }),
    ],
    new Set([local]),
  );
  expect(result).toMatchObject({
    status: "completed",
    label: "Latest run finished",
    startedAt: start,
    completedAt,
  });
  expect(menuBarProjectDuration(result!, Date.parse("2026-10-27T15:00:00.000Z"))).toBe(
    "Worked 12m",
  );
});

it("uses the earliest active work start and handles missing or future timestamps", () => {
  const later = "2026-10-27T12:05:00.000Z";
  const original = thread();
  const [result] = summarizeMenuBarProjects(
    [project],
    [thread({ runtime: { ...original.runtime!, activityStartedAt: later } }), original],
    new Set([local]),
  );
  expect(menuBarProjectDuration(result!, Date.parse("2026-10-27T12:13:00.000Z"))).toBe("For 13m");
  expect(menuBarProjectDuration({ startedAt: later, completedAt: null }, Date.parse(start))).toBe(
    "For <1m",
  );
  expect(
    menuBarProjectDuration({ startedAt: null, completedAt: null }, Date.parse(start)),
  ).toBeUndefined();
});

it("reports approval requests and failed runs", () => {
  expect(
    summarizeMenuBarProjects(
      [project],
      [thread({ hasPendingApprovals: true })],
      new Set([local]),
    )[0],
  ).toMatchObject({ status: "attention", label: "Needs approval" });
  const run = {
    runId: RunId.make("failed"),
    status: "failed" as const,
    requestedAt: start,
    startedAt: start,
    completedAt: "2026-10-27T12:02:00.000Z",
    assistantMessageId: null,
  };
  expect(
    summarizeMenuBarProjects(
      [project],
      [thread({ runtime: null, latestRun: run })],
      new Set([local]),
    )[0],
  ).toMatchObject({ status: "failed", label: "Latest run failed" });
});
