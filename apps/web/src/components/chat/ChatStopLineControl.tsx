import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { GaugeIcon } from "lucide-react";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

/** Usage stop line for one chat; without one, the environment stop line applies. */
export function ChatStopLineControl({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const canSave = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const save = useAtomCommand(serverEnvironment.updateSettings, "chat usage stop line");
  const override = settings?.promptUsageBudgetByThread[threadId];
  const fallback = settings?.promptUsageBudgetPercent ?? null;
  const effective = override === undefined ? fallback : override.percent;
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const percent = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(percent) && percent >= 1 && percent <= 100;
  const apply = async (next: { percent: number | null } | null) => {
    if (!canSave || saving) return;
    setSaving(true);
    const result = await save({
      environmentId,
      input: { patch: { promptUsageBudgetByThread: { [threadId]: next } } },
    });
    if (result._tag === "Success") setValue("");
    setSaving(false);
  };
  const label = effective === null ? "No stop line" : `Stop at ${effective}%`;
  return (
    <Popover>
      <PopoverTrigger
        render={<Button size="sm" variant="ghost" aria-label={`Usage stop line: ${label}`} />}
      >
        <GaugeIcon />
        <span className="hidden md:inline">{label}</span>
      </PopoverTrigger>
      <PopoverPopup width="md" align="start">
        <div className="space-y-3 text-sm">
          <div>
            <h2 className="font-semibold">Usage stop line for this chat</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Stops this chat's prompts once a subscription usage window reaches this percent used.{" "}
              {override === undefined
                ? `Using the default: ${fallback === null ? "off" : `${fallback}%`}.`
                : "This chat has its own stop line."}
            </p>
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (valid) void apply({ percent });
            }}
          >
            <span className="w-20">
              <Input
                type="number"
                min={1}
                max={100}
                step={1}
                aria-label="Chat usage stop line percent"
                placeholder={effective === null ? "Off" : String(effective)}
                value={value}
                disabled={!canSave || saving}
                onChange={(event) => setValue(event.target.value)}
              />
            </span>
            <span>%</span>
            <Button
              size="sm"
              variant="outline"
              type="submit"
              disabled={!valid || !canSave || saving}
            >
              Set
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button
              size="xs"
              variant="ghost"
              disabled={!canSave || saving || override?.percent === null}
              onClick={() => void apply({ percent: null })}
            >
              Turn off for this chat
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={!canSave || saving || override === undefined}
              onClick={() => void apply(null)}
            >
              Use default
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
