import { type NavigationTab } from "./navigation-tab-order";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { SettingsScheduledTasksRouteScreen } from "../settings/SettingsScheduledTasksRouteScreen";
import { UsageRouteScreen } from "../usage/UsageRouteScreen";

export function WorkspaceExtraTab(props: {
  tab: Exclude<NavigationTab, "threads" | "pullRequests">;
}) {
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      {props.tab === "scheduled" ? (
        <SettingsScheduledTasksRouteScreen />
      ) : (
        <UsageRouteScreen workspace />
      )}
    </>
  );
}
