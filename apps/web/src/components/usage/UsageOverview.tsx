import { UsageDisplaySettingsMenu } from "./UsageDisplaySettings";
import { cn } from "../../lib/utils";
import type { UsageDisplaySection, UsageDisplaySettings } from "@t3tools/contracts";
import { PromptUsageBudgetSettings } from "./PromptUsageBudgetSettings";
import { mergeUsage } from "@t3tools/shared/usageMerge";
import { USAGE_CONTRACT_VERSION } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import {
  AuthDiagnosticsReadScope,
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type ServerProviderUsageWindow,
  type TimestampFormat,
  type DesktopMenuBarSummary,
} from "@t3tools/contracts";
import { formatTokens, makeWindow } from "@t3tools/shared/usageFormat";
import { collectLimitAccounts, formatResetsIn, limitsNotice } from "@t3tools/shared/usageLimits";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { useEffect } from "react";

import { useRenderedAppearance } from "../../hooks/useTheme";
import { useClientSettings, usePrimarySettings } from "../../hooks/useSettings";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { PROVIDER_PRESENTATION } from "./usageProviders";

export function useOverviewEnvironmentId() {
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
  const display = useClientSettings((settings) => settings.usageDisplay);
  const heights = { compact: "h-28", comfortable: "h-36", large: "h-44" };
  return (
    <>
      <footer
        aria-label="Usage and scheduled tasks"
        data-usage-size={display.barSize}
        className={cn(
          "fixed inset-x-0 bottom-0 z-20 hidden border-t border-border bg-background px-5 py-3",
          heights[display.barSize],
          display.visible && "md:flex",
          display.barSize === "compact" && "py-2",
        )}
      >
        <div className="min-w-0 flex-1 overflow-x-auto">
          <UsageOverview compact />
        </div>
        <div className="ms-3 flex shrink-0 items-start border-s border-border ps-2">
          <UsageDisplaySettingsMenu />
        </div>
      </footer>
      {!display.visible ? (
        <div className="fixed bottom-3 right-3 z-20 hidden md:block">
          <UsageDisplaySettingsMenu />
        </div>
      ) : null}
    </>
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
  const nowMs = Date.parse(now);
  const theme = useRenderedAppearance();
  const display = useClientSettings((settings) => settings.usageDisplay);
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
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
  const ceiling = settings?.promptUsageBudgetPercent ?? null;
  const tokensLabel = totalTokens === undefined ? "Unavailable" : formatTokens(totalTokens);
  const tokensStatus = !connected
    ? "Disconnected"
    : !canReadUsage
      ? "Usage access required"
      : usage.error
        ? "Usage unavailable"
        : usage.isPending
          ? "Updating…"
          : (environment?.label ?? "Current environment");
  const tasksLabel =
    activeTasks === undefined
      ? tasks.error
        ? "Tasks unavailable"
        : "Unavailable"
      : `${activeTasks.length} active · ${tasks.data!.tasks.length - activeTasks.length} paused`;
  const nextLabel = next
    ? `Next: ${new Date(next.nextRunAt!).toLocaleString()}`
    : "No upcoming timed runs";
  const menuBarSummary = JSON.stringify({
    display,
    environmentLabel: environment?.label ?? "Current environment",
    theme,
    items: [
      ...accounts.flatMap((account) =>
        account.limits.windows.map((limit) => ({
          label: `${accountName(account)} · ${limit.windowDurationMins === 300 ? "5-hour" : limit.label}`,
          usedPercent: Math.max(0, Math.min(100, limit.usedPercent)),
          reset: limitResetCountdown(limit, nowMs),
          detail: limitResetTime(limit, timestampFormat, nowMs),
          action: "open-usage" as const,
          section: "limits" as const,
        })),
      ),
      {
        label: "Tokens today",
        value: tokensLabel,
        detail: tokensStatus,
        action: "open-usage",
        section: "tokens",
      },
      {
        label: "Scheduled tasks",
        section: "tasks",
        value: tasksLabel,
        detail: nextLabel,
        action: "open-scheduled-tasks",
      },
      {
        label: "Ceiling per prompt",
        section: "ceiling",
        value: ceiling === null ? "Off" : `${ceiling}%`,
        detail: "Subscription allowance",
        action: "open-scheduled-tasks",
      },
    ],
  } satisfies DesktopMenuBarSummary);
  // The footer is always mounted, so it alone feeds the macOS menu bar dropdown.
  // oxlint-disable-next-line t3code/react-effect-budget -- syncs with the Electron menu bar
  useEffect(() => {
    if (!compact) return;
    void window.desktopBridge?.setMenuBarSummary?.(
      JSON.parse(menuBarSummary) as DesktopMenuBarSummary,
    );
  }, [compact, menuBarSummary]);

  const refreshButton = (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label="Refresh token usage"
      disabled={!connected || !canReadUsage || usage.isPending}
      onClick={usage.refresh}
    >
      <RefreshCwIcon />
    </Button>
  );
  const limitSlots =
    accounts.length === 0 ? (
      <p style={usageSectionStyle(display, "limits")} className="text-muted-foreground">
        No provider limits available
      </p>
    ) : (
      accounts.map((account) => (
        <section
          key={account.key}
          style={usageSectionStyle(display, "limits")}
          className={
            compact
              ? "w-96 shrink-0 space-y-2 in-data-[usage-size=compact]:w-88 in-data-[usage-size=large]:w-104"
              : "space-y-3"
          }
        >
          <h2 className="text-xs font-medium text-muted-foreground">
            {compact ? `${accountName(account)} limits` : accountName(account)}
          </h2>
          <div className={compact ? "grid grid-cols-2 gap-5" : "space-y-3"}>
            <LimitRows
              limits={account.limits}
              checkedAt={account.limits.checkedAt}
              now={nowMs}
              timestampFormat={timestampFormat}
            />
          </div>
        </section>
      ))
    );
  const tasksBody = (
    <>
      <p className="font-medium">{tasksLabel}</p>
      <Tooltip>
        <TooltipTrigger render={<p className="max-w-64 truncate text-xs text-muted-foreground" />}>
          {nextLabel}
        </TooltipTrigger>
        <TooltipPopup>{nextLabel}</TooltipPopup>
      </Tooltip>
    </>
  );

  if (compact) {
    return (
      <div
        className={cn(
          "flex h-full min-w-max items-center gap-6 text-sm",
          display.alignment === "center"
            ? "justify-center"
            : display.alignment === "end"
              ? "justify-end"
              : "justify-start",
        )}
      >
        {limitSlots}
        <section
          style={usageSectionStyle(display, "tokens")}
          className="w-36 shrink-0 space-y-1 border-s border-border ps-6"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-medium text-muted-foreground">Tokens today</h2>
            {refreshButton}
          </div>
          <p className="text-2xl font-semibold tracking-tight tabular-nums in-data-[usage-size=compact]:text-xl in-data-[usage-size=large]:text-3xl">
            {tokensLabel}
          </p>
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  to="/usage"
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                />
              }
            >
              Usage details ↗
            </TooltipTrigger>
            <TooltipPopup>{tokensStatus}</TooltipPopup>
          </Tooltip>
        </section>
        <section
          style={usageSectionStyle(display, "tasks")}
          className="w-48 shrink-0 space-y-2 border-s border-border ps-6"
        >
          <h2 className="text-xs font-medium text-muted-foreground">Scheduled tasks</h2>
          {tasksBody}
          <Link
            to="/scheduled-tasks"
            search={{ environmentId }}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Manage tasks ↗
          </Link>
        </section>
        <section
          style={usageSectionStyle(display, "ceiling")}
          className="w-52 shrink-0 space-y-2 border-s border-border ps-6"
        >
          <PromptUsageBudgetSettings environmentId={environmentId} compact />
          <p className="text-xs text-muted-foreground">Subscription allowance per prompt</p>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 text-sm">
      <section
        style={usageSectionStyle(display, "tokens")}
        className="space-y-3 border-b border-border pb-4"
      >
        <div className="flex items-center gap-2">
          <h2 className="font-medium">Tokens today</h2>
          {refreshButton}
        </div>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{tokensLabel}</p>
        <p className="text-muted-foreground">{tokensStatus}</p>
      </section>
      <section
        style={usageSectionStyle(display, "limits")}
        className="space-y-3 border-b border-border pb-4"
      >
        <h2 className="font-medium">Usage limits</h2>
        {limitSlots}
        <Link to="/usage" className="text-primary underline underline-offset-2">
          View usage details
        </Link>
      </section>
      <section
        style={usageSectionStyle(display, "tasks")}
        className="space-y-3 border-b border-border pb-4"
      >
        <h2 className="font-medium">Scheduled tasks</h2>
        {tasksBody}
        <Button
          size="xs"
          variant="outline"
          render={<Link to="/scheduled-tasks" search={{ environmentId }} />}
        >
          Schedule / manage tasks
        </Button>
      </section>
      <section style={usageSectionStyle(display, "ceiling")} className="max-w-80">
        <PromptUsageBudgetSettings environmentId={environmentId} />
      </section>
    </div>
  );
}

type LimitAccount = ReturnType<typeof collectLimitAccounts>[number];

function accountName(account: LimitAccount) {
  return (
    account.displayName ??
    Object.values(PROVIDER_PRESENTATION).find((item) => item.driverKind === account.driver)
      ?.label ??
    account.driver
  );
}

function limitResetCountdown(limit: ServerProviderUsageWindow, now: number) {
  if (!limit.resetsAt) return "Reset time unavailable";
  if (Date.parse(limit.resetsAt) <= now) return "Reset due";
  return formatResetsIn(limit, now)?.replace(/^resets/, "Resets") ?? "Reset time unavailable";
}

function limitResetTime(
  limit: ServerProviderUsageWindow,
  timestampFormat: TimestampFormat,
  now: number,
) {
  if (!limit.resetsAt) return "Not reported by provider";
  if (Date.parse(limit.resetsAt) <= now) return "Waiting for provider update";
  return formatUpcomingTimestamp(limit.resetsAt, timestampFormat, now);
}

function LimitRows({
  limits,
  checkedAt,
  now,
  timestampFormat,
}: {
  limits: LimitAccount["limits"];
  checkedAt: string;
  now: number;
  timestampFormat: TimestampFormat;
}) {
  const notice = limitsNotice(limits);
  if (notice) return <p>{notice}</p>;
  return limits.windows.map((limit) => (
    <div key={limit.id} className="min-w-0 space-y-1.5">
      <Tooltip>
        <TooltipTrigger render={<div className="space-y-1.5" tabIndex={0} />}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {limit.windowDurationMins === 300 ? "5-hour" : limit.label}
            </span>
            <span className="text-lg font-semibold tracking-tight tabular-nums in-data-[usage-size=compact]:text-base in-data-[usage-size=large]:text-2xl">
              {Math.round(limit.usedPercent)}%
              <span className="ms-1 text-xs font-normal text-muted-foreground">used</span>
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-label={`${limit.label} usage`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={limit.usedPercent}
          >
            <div
              className={
                limit.usedPercent >= 90
                  ? "h-full rounded-full bg-destructive"
                  : limit.usedPercent >= 75
                    ? "h-full rounded-full bg-warning"
                    : "h-full rounded-full bg-primary"
              }
              style={{ width: `${Math.max(0, Math.min(100, limit.usedPercent))}%` }}
            />
          </div>
        </TooltipTrigger>
        <TooltipPopup>
          {limit.resetsAt
            ? `Resets ${new Date(limit.resetsAt).toLocaleString()}`
            : "Reset time unavailable"}
          . Reported {new Date(checkedAt).toLocaleString()}.
        </TooltipPopup>
      </Tooltip>
      <div className="pt-0.5">
        <p className="whitespace-nowrap text-sm font-medium tabular-nums in-data-[usage-size=compact]:text-xs in-data-[usage-size=large]:text-base">
          {limitResetCountdown(limit, now)}
        </p>
        <p className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          {limitResetTime(limit, timestampFormat, now)}
        </p>
      </div>
    </div>
  ));
}

function usageSectionStyle(display: UsageDisplaySettings, section: UsageDisplaySection) {
  return {
    order: display.order.indexOf(section),
    ...(display.hidden.includes(section) ? { display: "none" } : {}),
  };
}
