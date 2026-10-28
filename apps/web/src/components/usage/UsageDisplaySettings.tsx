import { ArrowDownIcon, ArrowUpIcon, Settings2Icon } from "lucide-react";
import {
  DEFAULT_USAGE_DISPLAY_SETTINGS,
  type UsageDisplaySection,
  type UsageDisplaySettings,
} from "@t3tools/contracts";

import { persistClientSettingsUpdate, useClientSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";

export const USAGE_BAR_HEIGHT = { compact: 112, comfortable: 144, large: 176 };
const SECTIONS: Record<UsageDisplaySection, string> = {
  limits: "Usage & resets",
  tokens: "Token costs",
  tasks: "Scheduled tasks",
  ceiling: "Ceiling per prompt",
};
const SIZES = { compact: "Small", comfortable: "Medium", large: "Large" };

export function UsageDisplaySettingsPanel() {
  const display = useClientSettings((settings) => settings.usageDisplay);
  const update = (patch: Partial<UsageDisplaySettings>) => {
    void persistClientSettingsUpdate((current) => ({
      ...current,
      usageDisplay: { ...current.usageDisplay, ...patch },
    })).catch(() => toastManager.add({ type: "error", title: "Could not save display settings" }));
  };
  const move = (index: number, direction: number) => {
    const order = [...display.order];
    const other = index + direction;
    if (other < 0 || other >= order.length) return;
    [order[index], order[other]] = [order[other]!, order[index]!];
    update({ order });
  };
  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-1">
        <h2 className="font-semibold">Usage display</h2>
        <p className="text-xs text-muted-foreground">Customize this device’s bar and macOS menu.</p>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span>Show bottom bar</span>
        <Switch
          checked={display.visible}
          onCheckedChange={(visible) => update({ visible })}
          aria-label="Show bottom usage bar"
        />
      </div>
      {(["barSize", "menuSize"] as const).map((field) => (
        <div key={field} className="flex items-center justify-between gap-4">
          <span>{field === "barSize" ? "Bottom bar size" : "Menu size"}</span>
          <div className="w-32">
            <Select
              value={display[field]}
              onValueChange={(value) => {
                if (value) update({ [field]: value });
              }}
            >
              <SelectTrigger aria-label={field === "barSize" ? "Bottom bar size" : "Menu size"}>
                <SelectValue>{SIZES[display[field]]}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="compact">Small</SelectItem>
                <SelectItem value="comfortable">Medium</SelectItem>
                <SelectItem value="large">Large</SelectItem>
              </SelectPopup>
            </Select>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-4">
        <span>Bar alignment</span>
        <div className="w-32">
          <Select
            value={display.alignment}
            onValueChange={(value) => {
              if (value) update({ alignment: value });
            }}
          >
            <SelectTrigger aria-label="Usage bar alignment">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="start">Left</SelectItem>
              <SelectItem value="center">Center</SelectItem>
              <SelectItem value="end">Right</SelectItem>
            </SelectPopup>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Section order & visibility</h3>
        <p className="text-xs text-muted-foreground">Applies to both the bar and menu.</p>
        {display.order.map((section, index) => (
          <div
            key={section}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
          >
            <span className="min-w-0 flex-1">{SECTIONS[section]}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Move ${SECTIONS[section]} earlier`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Move ${SECTIONS[section]} later`}
              disabled={index === display.order.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDownIcon />
            </Button>
            <Switch
              checked={!display.hidden.includes(section)}
              aria-label={`Show ${SECTIONS[section]}`}
              onCheckedChange={(shown) =>
                update({
                  hidden: shown
                    ? display.hidden.filter((item) => item !== section)
                    : [...display.hidden, section],
                })
              }
            />
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" onClick={() => update(DEFAULT_USAGE_DISPLAY_SETTINGS)}>
        Reset display settings
      </Button>
    </div>
  );
}

export function UsageDisplaySettingsMenu() {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button size="icon" variant="ghost" aria-label="Usage display settings" />}
      >
        <Settings2Icon />
      </PopoverTrigger>
      <PopoverPopup width="lg" side="top" align="end">
        <UsageDisplaySettingsPanel />
      </PopoverPopup>
    </Popover>
  );
}
