import { EllipsisIcon, SquarePenIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";

import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ClassicChatHeader({
  title,
  controlsRef,
  tools,
  onNewChat,
}: {
  title: string;
  controlsRef: Ref<HTMLDivElement>;
  tools: ReactNode;
  onNewChat: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3 [-webkit-app-region:no-drag]">
      <div ref={controlsRef} className="flex min-w-0 flex-1 items-center gap-1" />
      <h1 className="hidden max-w-48 truncate text-sm text-muted-foreground lg:block">{title}</h1>
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button size="icon" variant="ghost" aria-label="New chat" onClick={onNewChat} />
            }
          >
            <SquarePenIcon />
          </TooltipTrigger>
          <TooltipPopup>New chat</TooltipPopup>
        </Tooltip>
        <Popover>
          <PopoverTrigger render={<Button size="icon" variant="ghost" aria-label="Chat tools" />}>
            <EllipsisIcon />
          </PopoverTrigger>
          <PopoverPopup align="end" padding="compact">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Chat tools</p>
              {tools}
            </div>
          </PopoverPopup>
        </Popover>
      </div>
    </div>
  );
}

export function ClassicChatWelcome() {
  return (
    <div className="mx-auto max-w-xl space-y-3 px-4 pb-4 text-center">
      <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">What can I help with?</h1>
      <p className="text-sm text-muted-foreground sm:text-base">
        Ask a question, explore an idea, or get something done.
      </p>
    </div>
  );
}
