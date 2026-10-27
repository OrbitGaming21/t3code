import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "../state/server";
import { selectChatBillingProvider } from "../components/chat/chatBilling";
import { composerDraftHasUserContent, useComposerDraftStore } from "../composerDraftStore";
import { useClientSettings } from "./useSettings";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { SCRATCH_PROJECT_SCOPE_KEY } from "@t3tools/client-runtime/state/project-grouping";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useUiStateStore } from "../uiStateStore";
import { availableScratchWorkspaceRoot } from "@t3tools/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useEnvironments } from "~/state/environments";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { useNewThreadHandler } from "./useHandleNewThread";

function reportScratchFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export function useScratchProject() {
  const { environments } = useEnvironments();
  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();
  const billing = useClientSettings((settings) => settings.chatBillingPreference);

  const scratchWorkspaceRootFor = (environmentId: EnvironmentId | null): string | null => {
    const environment = environments.find((entry) => entry.environmentId === environmentId);
    return availableScratchWorkspaceRoot(environment?.connection.phase, environment?.serverConfig);
  };

  const scratchEnvironmentId = (current: EnvironmentId | null): EnvironmentId | null => {
    if (current !== null) return scratchWorkspaceRootFor(current) !== null ? current : null;
    const offering = environments.filter(
      (entry) => scratchWorkspaceRootFor(entry.environmentId) !== null,
    );
    return offering.length === 1 ? (offering[0]?.environmentId ?? null) : null;
  };

  const openScratchProject = async (
    environmentId: EnvironmentId,
    failureTitle = "Could not start without a project",
  ): Promise<EnvironmentProject | null> => {
    const result = await openScratch({ environmentId, input: {} });
    if (result._tag === "Success") return result.value;
    if (!isAtomCommandInterrupted(result)) {
      reportScratchFailure(failureTitle, squashAtomCommandFailure(result));
    }
    return null;
  };

  const startScratchThread = async (environmentId: EnvironmentId) => {
    const project = await openScratchProject(environmentId);
    if (project) {
      await handleNewThread(scopeProjectRef(project.environmentId, project.id)).then(
        (created) => {
          if (created) {
            const store = useComposerDraftStore.getState();
            const draft = store.getComposerDraft(created.draftId);
            const providers =
              appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId))?.providers ??
              [];
            const selection = selectChatBillingProvider(providers, billing);
            if (selection && !composerDraftHasUserContent(draft))
              store.setModelSelection(created.draftId, selection);
          }
          useThreadSelectionStore.getState().clearSelection();
          useUiStateStore.getState().setSidebarProjectScopeKey(SCRATCH_PROJECT_SCOPE_KEY);
        },
        (error: unknown) => reportScratchFailure("Could not start without a project", error),
      );
    }
  };

  return { scratchWorkspaceRootFor, scratchEnvironmentId, openScratchProject, startScratchThread };
}
