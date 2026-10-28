import {
  resolveThreadWorkingStartedAt,
  threadRuntimeIsActive,
  formatWorkingDurationLabel,
  type EnvironmentProject,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { DesktopMenuBarSummary, EnvironmentId } from "@t3tools/contracts";

type ProgressThread = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "projectId"
  | "title"
  | "archivedAt"
  | "deletedAt"
  | "runtime"
  | "latestRun"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "blockedOnThreadWait"
>;
type ProgressProject = Pick<EnvironmentProject, "environmentId" | "id" | "title" | "isScratch">;
type ProjectStatus = NonNullable<DesktopMenuBarSummary["projects"]>[number]["status"];
const PRIORITY: Record<ProjectStatus, number> = {
  attention: 0,
  working: 1,
  failed: 2,
  completed: 3,
  idle: 4,
  offline: 5,
};

export function summarizeMenuBarProjects(
  projects: readonly ProgressProject[],
  threads: readonly ProgressThread[],
  liveEnvironments: ReadonlySet<EnvironmentId>,
) {
  const byProject = new Map<string, ProgressThread[]>();
  for (const thread of threads) {
    if (thread.archivedAt || thread.deletedAt) continue;
    const key = JSON.stringify([thread.environmentId, thread.projectId]);
    const group = byProject.get(key) ?? [];
    group.push(thread);
    byProject.set(key, group);
  }
  return projects
    .filter((project) => !project.isScratch)
    .map((project) => {
      const projectThreads =
        byProject.get(JSON.stringify([project.environmentId, project.id])) ?? [];
      const active = projectThreads.filter((thread) => threadRuntimeIsActive(thread.runtime));
      const approval = projectThreads.find(
        (thread) => thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval",
      );
      const input = projectThreads.find(
        (thread) => thread.hasPendingUserInput || thread.pendingSubagentRequest === "user_input",
      );
      const waiting = active.find(
        (thread) => thread.runtime?.status === "waiting" || thread.blockedOnThreadWait,
      );
      const latest = projectThreads
        .filter((thread) => thread.latestRun?.completedAt)
        .toSorted((a, b) => b.latestRun!.completedAt!.localeCompare(a.latestRun!.completedAt!))[0];
      const live = liveEnvironments.has(project.environmentId);
      const status: ProjectStatus = !live
        ? "offline"
        : approval || input
          ? "attention"
          : active.length
            ? "working"
            : latest?.latestRun?.status === "failed"
              ? "failed"
              : latest?.latestRun?.status === "completed"
                ? "completed"
                : "idle";
      const label = !live
        ? "Unavailable"
        : approval
          ? "Needs approval"
          : input
            ? "Waiting for input"
            : active.length
              ? waiting && active.length === 1
                ? "Waiting"
                : `${active.length} ${active.length === 1 ? "agent" : "agents"} working`
              : status === "failed"
                ? "Latest run failed"
                : status === "completed"
                  ? "Latest run finished"
                  : "Idle";
      const starts = active
        .map(resolveThreadWorkingStartedAt)
        .filter((start) => start !== null)
        .toSorted();
      const focused = approval ?? input ?? active[0] ?? latest;
      return {
        environmentId: project.environmentId,
        name: project.title.slice(0, 200),
        status,
        label,
        detail: live
          ? focused?.title.slice(0, 200)
          : "Connect this environment to see current progress",
        startedAt: live
          ? (starts[0] ?? (active.length ? null : (latest?.latestRun?.startedAt ?? null)))
          : null,
        completedAt: live && !active.length ? (latest?.latestRun?.completedAt ?? null) : null,
      };
    })
    .toSorted((a, b) => PRIORITY[a.status] - PRIORITY[b.status] || a.name.localeCompare(b.name))
    .slice(0, 50);
}

export function menuBarProjectDuration(
  project: { startedAt: string | null; completedAt: string | null },
  now: number,
) {
  if (!project.startedAt) return undefined;
  const elapsed =
    (project.completedAt ? Date.parse(project.completedAt) : now) - Date.parse(project.startedAt);
  if (!Number.isFinite(elapsed)) return undefined;
  const duration = elapsed < 60_000 ? "<1m" : formatWorkingDurationLabel(elapsed);
  return project.completedAt ? `Worked ${duration}` : `For ${duration}`;
}
