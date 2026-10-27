import { MessageCircleIcon, SquareTerminalIcon } from "lucide-react";

import { Toggle, ToggleGroup } from "../ui/toggle-group";

export type SidebarMode = "threads" | "chats";

/** Chats are threads without a project; Threads are everything else. */
export function SidebarModeTabs({
  mode,
  onSelect,
}: {
  mode: SidebarMode;
  onSelect: (mode: SidebarMode) => void;
}) {
  return (
    <ToggleGroup
      aria-label="Sidebar mode"
      className="w-full *:flex-1"
      value={[mode]}
      onValueChange={(next) => {
        const value = next[0];
        if (value === "threads" || value === "chats") onSelect(value);
      }}
    >
      <Toggle value="threads">
        <SquareTerminalIcon />
        Threads
      </Toggle>
      <Toggle value="chats">
        <MessageCircleIcon />
        Chat
      </Toggle>
    </ToggleGroup>
  );
}
