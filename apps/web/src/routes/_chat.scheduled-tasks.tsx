import { createFileRoute } from "@tanstack/react-router";

import { AppRouteModal, AppRouteModalClose } from "../components/AppRouteModal";
import { ScheduledTasksSettings } from "../components/settings/ScheduledTasksSettings";
import { SettingsScopeProvider } from "../components/settings/SettingsScopeContext";
import { validateScheduledTasksSearch } from "../components/settings/scheduledTasksSettings.logic";
import {
  retainSettingsScope,
  validateSettingsRouteSearch,
} from "../components/settings/settingsScopeNavigation";
import { useOverviewEnvironmentId } from "../components/usage/UsageOverview";
import { PromptUsageBudgetSettings } from "../components/usage/PromptUsageBudgetSettings";

function ScheduledTasksPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const ceilingEnvironmentId = useOverviewEnvironmentId();
  return (
    <SettingsScopeProvider
      search={search}
      onChange={(next) => {
        void navigate({
          search: () => ({ project: next.project, machine: next.machine, checkout: next.checkout }),
          resetScroll: false,
        });
      }}
    >
      <AppRouteModal label="Scheduled tasks">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b ps-5 pe-2">
            <h1 className="text-sm font-medium">Scheduled tasks</h1>
            <div className="ms-auto flex shrink-0 items-center gap-3 text-xs">
              {ceilingEnvironmentId ? (
                <PromptUsageBudgetSettings environmentId={ceilingEnvironmentId} compact inline />
              ) : null}
              <AppRouteModalClose />
            </div>
          </header>
          <ScheduledTasksSettings
            {...(search.environmentId ? { environmentId: search.environmentId } : {})}
            taskId={search.taskId}
          />
        </div>
      </AppRouteModal>
    </SettingsScopeProvider>
  );
}

export const Route = createFileRoute("/_chat/scheduled-tasks")({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...validateSettingsRouteSearch(raw),
    ...validateScheduledTasksSearch(raw),
  }),
  search: { middlewares: [retainSettingsScope] },
  component: ScheduledTasksPage,
});
