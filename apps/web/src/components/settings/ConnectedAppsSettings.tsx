import { toastManager } from "../ui/toast";
import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationReadScope, type EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { useSettingsScope } from "./SettingsScopeContext";
import { useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { ensureLocalApi } from "../../localApi";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsSection } from "./settingsLayout";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { Label } from "../ui/label";

export function ConnectedAppsSettings() {
  const { environments } = useSettingsScope();
  return (
    <SettingsSection id="connected-apps" title="Connected apps">
      <p className="mb-3 text-sm text-muted-foreground">
        Connect apps to let your agents use their tools in Chat and coding threads. Add the app’s
        remote MCP server URL, then sign in. Connections belong to the selected environment.
      </p>
      {environments.map((environment) => (
        <EnvironmentApps
          key={environment.environmentId}
          environmentId={environment.environmentId}
          label={environment.label}
          connected={environment.connection.phase === "connected"}
        />
      ))}
      {environments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Connect an environment to add apps.</p>
      ) : null}
    </SettingsSection>
  );
}

function EnvironmentApps({
  environmentId,
  label,
  connected,
}: {
  environmentId: EnvironmentId;
  label: string;
  connected: boolean;
}) {
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    connected && canRead ? serverEnvironment.connectedApps({ environmentId, input: {} }) : null,
  );
  const canAdd = useAtomValue(serverEnvironment.addConnectedApp.permissionAtom(environmentId));
  const canRemove = useAtomValue(
    serverEnvironment.removeConnectedApp.permissionAtom(environmentId),
  );
  const canSignIn = useAtomValue(
    serverEnvironment.signInConnectedApp.permissionAtom(environmentId),
  );
  const add = useAtomCommand(serverEnvironment.addConnectedApp, "add connected app");
  const remove = useAtomCommand(serverEnvironment.removeConnectedApp, "remove connected app");
  const signIn = useAtomCommand(serverEnvironment.signInConnectedApp, "sign in to app");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const connect = async (id: string) => {
    if (!connected || !canSignIn || busy) return;
    setBusy(true);
    const result = await signIn({ environmentId, input: { id, origin: window.location.origin } });
    if (result._tag === "Success" && result.value.authorizationUrl) {
      await ensureLocalApi()
        .shell.openExternal(result.value.authorizationUrl)
        .catch(() => {
          toastManager.add({
            type: "error",
            title: "Could not open app sign-in",
            description: "Try signing in again, and allow T3 Code to open your browser.",
          });
        });
    }
    query.refresh();
    setBusy(false);
  };
  const create = async () => {
    if (!name.trim() || !url.trim() || busy || !canAdd) return;
    setBusy(true);
    const result = await add({ environmentId, input: { name: name.trim(), url: url.trim() } });
    if (result._tag === "Success") {
      setName("");
      setUrl("");
    }
    query.refresh();
    setBusy(false);
  };
  const disconnect = async (id: string) => {
    if (!connected || !canRemove || busy) return;
    setBusy(true);
    await remove({ environmentId, input: { id } });
    query.refresh();
    setBusy(false);
  };
  return (
    <SettingsGroup className="mb-3">
      <div className="flex items-center gap-3 px-4 py-3">
        <h3 className="flex-1 text-sm font-medium">{label}</h3>
        <Button
          size="xs"
          variant="ghost"
          disabled={!connected || !canRead || busy || query.isPending}
          onClick={query.refresh}
        >
          Refresh
        </Button>
      </div>
      {!connected ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          Reconnect this environment to manage apps.
        </p>
      ) : !canRead ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Settings access is required.</p>
      ) : query.error ? (
        <p role="alert" className="px-4 py-3 text-sm text-destructive">
          {query.error}
        </p>
      ) : query.data?.apps.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">No apps connected yet.</p>
      ) : (
        query.data?.apps.map((app) => (
          <div key={app.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{app.name}</p>
              <p className="truncate text-xs text-muted-foreground">{new URL(app.url).host}</p>
            </div>
            <Badge variant={app.status === "connected" ? "secondary" : "outline"}>
              {app.status === "connected" ? "Connected" : "Sign in required"}
            </Badge>
            <Button
              size="xs"
              variant="outline"
              disabled={!connected || !canSignIn || busy}
              onClick={() => void connect(app.id)}
            >
              {app.status === "connected" ? "Reconnect" : "Sign in"}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={!connected || !canRemove || busy}
              onClick={() => void disconnect(app.id)}
            >
              Remove
            </Button>
          </div>
        ))
      )}
      <form
        className="space-y-3 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Label>
          App name
          <Input
            aria-label={`App name on ${label}`}
            placeholder="My app"
            value={name}
            maxLength={80}
            disabled={!connected || !canAdd || busy}
            onChange={(event) => setName(event.target.value)}
          />
        </Label>
        <Label>
          Remote MCP URL
          <Input
            aria-label={`MCP URL on ${label}`}
            type="url"
            placeholder="https://example.com/mcp"
            value={url}
            maxLength={2048}
            disabled={!connected || !canAdd || busy}
            onChange={(event) => setUrl(event.target.value)}
          />
        </Label>
        <Button
          size="sm"
          variant="outline"
          type="submit"
          disabled={!connected || !canAdd || busy || !name.trim() || !url.trim()}
        >
          Add app
        </Button>
        <p className="text-xs text-muted-foreground">
          Supports remote MCP over HTTP with automatic OAuth registration. Apps requiring a
          preconfigured client ID or API key are not supported yet. Removing a connection deletes
          its saved login from this environment; revoke access in the app’s own settings if needed.
        </p>
      </form>
    </SettingsGroup>
  );
}
