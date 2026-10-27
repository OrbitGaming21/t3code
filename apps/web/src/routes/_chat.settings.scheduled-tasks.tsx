import { createFileRoute, redirect } from "@tanstack/react-router";

import { validateScheduledTasksSearch } from "../components/settings/scheduledTasksSettings.logic";

export const Route = createFileRoute("/_chat/settings/scheduled-tasks")({
  validateSearch: validateScheduledTasksSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/scheduled-tasks", search, replace: true });
  },
});
