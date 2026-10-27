import { ScheduledUsageCeiling } from "./ScheduledUsageCeiling";
import { mergeUsage } from "@t3tools/shared/usageMerge";
import { USAGE_CONTRACT_VERSION } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import {
  AuthDiagnosticsReadScope,
  AuthOrchestrationReadScope,
  type EnvironmentId,
} from "@t3tools/contracts";
import { formatTokens, makeWindow } from "@t3tools/shared/usageFormat";
import { collectLimitAccounts, limitsNotice } from "@t3tools/shared/usageLimits";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { useEffect } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { PROVIDER_PRESENTATION } from "./usageProviders";

function useOverviewEnvironmentId() {
  const target = useThreadRouteTarget();
  const primary = usePrimaryEnvironmentId();
  return target?.kind === "server" ? target.threadRef.environmentId : primary;
}

export function UsageOverviewMenu() {
  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" variant="ghost" />}>
        T3 Code <ChevronDownIcon className="size-3" />
      </PopoverTrigger>
      <PopoverPopup width="lg" align="start">
        <UsageOverview compact={false} />
      </PopoverPopup>
    </Popover>
  );
}

export function UsageOverviewFooter() {
  return (
    <footer
      aria-label="Usage and scheduled tasks"
      className="fixed inset-x-0 bottom-0 z-20 h-28 overflow-x-auto border-t border-border bg-background px-4 py-3"
    >
      <UsageOverview compact />
    </footer>
  );
}

function UsageOverview({ compact }: { compact: boolean }) {
  const environmentId = useOverviewEnvironmentId();
  return environmentId ? (
    <EnvironmentOverview key={environmentId} environmentId={environmentId} compact={compact} />
  ) : (
    <p className="text-xs text-muted-foreground">
      Connect an environment to see usage and scheduled tasks.
    </p>
  );
}

function EnvironmentOverview({
  environmentId,
  compact,
}: {
  environmentId: EnvironmentId;
  compact: boolean;
}) {
  const environment = useEnvironment(environmentId);
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const now = useNowMinute();
  const usageWindow = makeWindow(1, new Date(now));
  const connected = environment?.connection.phase === "connected";
  const canReadUsage = useEnvironmentScope(environmentId, AuthDiagnosticsReadScope);
  const canReadTasks = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const usage = useEnvironmentQuery(
    connected && canReadUsage
      ? serverEnvironment.usageSummary({ environmentId, input: usageWindow })
      : null,
  );
  const tasks = useEnvironmentQuery(
    connected && canReadTasks
      ? serverEnvironment.scheduledTasksLive({ environmentId, input: {} })
      : null,
  );
  const accounts = collectLimitAccounts(
    new Map([
      [
        environmentId,
        { entry: { target: { label: environment?.label ?? "Environment" } }, serverConfig: config },
      ],
    ]),
  );
  const totalTokens = usage.data
    ? mergeUsage(
        [{ environmentId, label: environment?.label ?? "Environment", summary: usage.data }],
        USAGE_CONTRACT_VERSION,
      ).totalTokens
    : undefined;
  const activeTasks = tasks.data?.tasks.filter((task) => task.enabled);
  const next = activeTasks
    ?.filter((task) => task.nextRunAt !== null)
    .toSorted((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))[0];
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const ceiling = settings?.scheduledTaskUsageCeilingPercent ?? null;
  const summary = [
    `Tokens today: ${totalTokens === undefined ? "Unavailable" : formatTokens(totalTokens)}`,
    ...accounts.flatMap((account) =>
      account.limits.windows.map(
        (limit) =>
          `${account.displayName ?? account.driver} ${limit.label}: ${Math.round(limit.usedPercent)}% used`,
      ),
    ),
    activeTasks
      ? `Scheduled: ${activeTasks.length} active · ${tasks.data!.tasks.length - activeTasks.length} paused`
      : "Scheduled: Unavailable",
    `Scheduled usage ceiling: ${ceiling === null ? "Off" : `${ceiling}%`}`,
  ];
  const summaryKey = summary.join("\n");
  // The footer is always mounted, so it alone feeds the macOS menu bar dropdown.
  // oxlint-disable-next-line t3code/react-effect-budget -- syncs with the Electron menu bar
  useEffect(() => {
    if (!compact) return;
    void window.desktopBridge?.setMenuBarSummary?.({ lines: summaryKey.split("\n") });
  }, [compact, summaryKey]);
  const sectionClass = compact ? "min-w-44 flex-1 space-y-1" : "space-y-2";
  return (
    <div className={cn("text-xs", compact ? "flex min-w-max items-start gap-6" : "space-y-4")}>
      <section className={sectionClass}>
        <div className="flex items-center gap-2">
          <h2 className="font-medium">Tokens today</h2>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Refresh token usage"
            disabled={!connected || !canReadUsage || usage.isPending}
            onClick={usage.refresh}
          >
            <RefreshCwIcon />
          </Button>
        </div>
        <p className="text-lg font-semibold tabular-nums">
          {totalTokens === undefined ? "Unavailable" : formatTokens(totalTokens)}
        </p>
        <p className="text-muted-foreground">
          {!connected
            ? "Disconnected"
            : !canReadUsage
              ? "Usage access required"
              : usage.error
                ? "Usage unavailable"
                : usage.isPending
                  ? "Updating…"
                  : (environment?.label ?? "Current environment")}
        </p>
      </section>
      <section className={cn(sectionClass, compact && "max-h-22 min-w-64 overflow-y-auto")}>
        <h2 className="font-medium">Usage limits</h2>
        {accounts.length === 0 ? (
          <p className="text-muted-foreground">No provider limits available</p>
        ) : (
          accounts.map((account) => {
            const provider = Object.values(PROVIDER_PRESENTATION).find(
              (item) => item.driverKind === account.driver,
            );
            const notice = limitsNotice(account.limits);
            return (
              <div key={account.key} className="space-y-1">
                <p className="text-muted-foreground">
                  {account.displayName ?? provider?.label ?? account.driver}
                </p>
                {notice ? (
                  <p>{notice}</p>
                ) : (
                  account.limits.windows.map((limit) => (
                    <Tooltip key={limit.id}>
                      <TooltipTrigger
                        render={<div className="flex items-center gap-2" tabIndex={0} />}
                      >
                        <span className="min-w-16">{limit.label}</span>
                        <div
                          className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
                          role="meter"
                          aria-label={`${limit.label} usage`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={limit.usedPercent}
                        >
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${limit.usedPercent}%` }}
                          />
                        </div>
                        <span className="tabular-nums">{Math.round(limit.usedPercent)}% used</span>
                      </TooltipTrigger>
                      <TooltipPopup>
                        {limit.resetsAt
                          ? `Resets ${new Date(limit.resetsAt).toLocaleString()}`
                          : "Reset time unavailable"}
                        . Reported {new Date(account.limits.checkedAt).toLocaleString()}.
                      </TooltipPopup>
                    </Tooltip>
                  ))
                )}
              </div>
            );
          })
        )}
        <Link to="/usage" className="text-primary underline underline-offset-2">
          View usage details
        </Link>
      </section>
      <section className={sectionClass}>
        <h2 className="font-medium">Scheduled tasks</h2>
        <p>
          {activeTasks === undefined
            ? tasks.error
              ? "Tasks unavailable"
              : "Unavailable"
            : `${activeTasks.length} active · ${tasks.data!.tasks.length - activeTasks.length} paused`}
        </p>
        <p className="max-w-64 truncate text-muted-foreground">
          {next ? `Next: ${new Date(next.nextRunAt!).toLocaleString()}` : "No upcoming timed runs"}
        </p>
        <Button
          size="xs"
          variant="outline"
          render={<Link to="/settings/scheduled-tasks" search={{ environmentId }} />}
        >
          Schedule / manage tasks
        </Button>
      </section>
      <section className={cn(sectionClass, "max-w-80")}>
        <ScheduledUsageCeiling environmentId={environmentId} compact={compact} />
      </section>
    </div>
  );
}
