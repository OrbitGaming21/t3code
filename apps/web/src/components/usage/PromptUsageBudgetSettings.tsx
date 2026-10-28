import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function PromptUsageBudgetSettings({
  environmentId,
  compact = false,
  inline = false,
}: {
  environmentId: EnvironmentId;
  compact?: boolean;
  /** Label beside the field, for toolbars. */
  inline?: boolean;
}) {
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const canSave = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const save = useAtomCommand(serverEnvironment.updateSettings, "subscription ceiling per prompt");
  const saved = settings?.promptUsageBudgetPercent ?? null;
  const [draft, setDraft] = useState<{ saved: number | null; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft?.saved === saved ? draft.value : saved === null ? "" : String(saved);
  const percent = value.trim() === "" ? null : Number(value);
  const valid = percent === null || (Number.isInteger(percent) && percent >= 0 && percent <= 100);
  const changed = valid && percent !== saved;
  const commit = async () => {
    if (!changed || !canSave || saving) return;
    setSaving(true);
    const result = await save({
      environmentId,
      input: { patch: { promptUsageBudgetPercent: percent } },
    });
    if (result._tag === "Success") setDraft(null);
    setSaving(false);
  };
  return (
    <div className={inline ? "flex items-center gap-2" : "space-y-1"}>
      <Label>Default ceiling per prompt</Label>
      <div className="flex items-center gap-2">
        <div className="w-20">
          <Input
            size="default"
            aria-label="Subscription ceiling per prompt percent"
            type="number"
            min={0}
            max={100}
            step={1}
            placeholder="Off"
            value={value}
            disabled={!canSave || !settings || saving}
            aria-invalid={!valid}
            onChange={(event) => setDraft({ saved, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commit();
            }}
          />
        </div>
        <span>%</span>
        <Button
          size="sm"
          variant="outline"
          disabled={!changed || !canSave || saving}
          onClick={() => void commit()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {!valid || !compact ? (
        <p className="text-muted-foreground">
          {!valid
            ? "Enter 0–100, or clear to disable."
            : "Stops each prompt when reported account usage increases by this percentage of a quota window. Checks every 30 seconds; reporting delays and concurrent account activity can cause overshoot. Missing limits prevent a prompt from starting. Clear to disable; 0 pauses subscription prompts."}
        </p>
      ) : null}
    </div>
  );
}
