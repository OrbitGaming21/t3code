import { AudioLinesIcon, MicIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  isSpeechInputAvailable,
  startSpeechInput,
  type SpeechInputSession,
} from "../../voice/speechInput";
import { cancelSpeech, speak, spokenReplyText } from "../../voice/speechOutput";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";

// Conversation mode sends once you pause this long after speaking.
const CONVERSATION_PAUSE_MS = 1600;
// Recognizers report words every few hundred milliseconds while you speak.
const HEARING_HOLD_MS = 700;

export type VoiceReply = { readonly id: string; readonly text: string };

type ListenMode = "dictate" | "converse";

export function ComposerVoiceControl({
  isRunning,
  latestReply,
  locale,
  onInsertText,
  onSendText,
}: {
  readonly isRunning: boolean;
  readonly latestReply: VoiceReply | null;
  readonly locale: string | undefined;
  readonly onInsertText: (text: string) => void;
  readonly onSendText: (text: string) => void;
}) {
  const [listening, setListening] = useState<ListenMode | null>(null);
  const [conversation, setConversation] = useState(false);
  const [awaitingReplyAfter, setAwaitingReplyAfter] = useState<string | null>(null);
  const [partial, setPartial] = useState("");
  const [hearing, setHearing] = useState(false);
  const sessionRef = useRef<SpeechInputSession | null>(null);
  const pauseTimerRef = useRef<number | null>(null);
  const hearingTimerRef = useRef<number | null>(null);
  const conversationRef = useRef(false);

  const clearPauseTimer = () => {
    if (pauseTimerRef.current !== null) window.clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = null;
    if (hearingTimerRef.current !== null) window.clearTimeout(hearingTimerRef.current);
    hearingTimerRef.current = null;
    setHearing(false);
  };

  const endConversation = () => {
    conversationRef.current = false;
    setConversation(false);
    setAwaitingReplyAfter(null);
    cancelSpeech();
  };

  const startListening = (mode: ListenMode) => {
    sessionRef.current?.cancel();
    setPartial("");
    const session = startSpeechInput(
      {
        onPartial: (text) => {
          setPartial(text);
          if (text.trim().length === 0) return;
          setHearing(true);
          if (hearingTimerRef.current !== null) window.clearTimeout(hearingTimerRef.current);
          hearingTimerRef.current = window.setTimeout(() => setHearing(false), HEARING_HOLD_MS);
          if (mode !== "converse") return;
          if (pauseTimerRef.current !== null) window.clearTimeout(pauseTimerRef.current);
          pauseTimerRef.current = window.setTimeout(
            () => sessionRef.current?.stop(),
            CONVERSATION_PAUSE_MS,
          );
        },
        onFinal: (text) => {
          clearPauseTimer();
          sessionRef.current = null;
          setListening(null);
          setPartial("");
          const transcript = text.trim();
          if (transcript.length === 0) {
            if (mode === "converse") endConversation();
            return;
          }
          if (mode === "converse") {
            setAwaitingReplyAfter(latestReply?.id ?? "");
            onSendText(transcript);
          } else {
            onInsertText(transcript);
          }
        },
        onError: (message) => {
          clearPauseTimer();
          sessionRef.current = null;
          setListening(null);
          setPartial("");
          endConversation();
          toastManager.add({ type: "error", title: "Voice input stopped", description: message });
        },
      },
      locale,
    );
    if (!session) return;
    sessionRef.current = session;
    setListening(mode);
  };

  const pendingReply =
    conversation &&
    awaitingReplyAfter !== null &&
    !isRunning &&
    latestReply &&
    latestReply.id !== awaitingReplyAfter
      ? latestReply
      : null;
  const speaking = pendingReply !== null;

  const pendingReplyId = pendingReply?.id ?? null;
  const pendingReplyText = pendingReply?.text ?? "";
  const resumeListening = useEffectEvent(() => {
    setAwaitingReplyAfter(null);
    if (conversationRef.current) startListening("converse");
  });

  // oxlint-disable-next-line t3code/react-effect-budget -- speaks the agent's reply through the OS speech engine once its turn ends.
  useEffect(() => {
    if (pendingReplyId === null) return;
    let active = true;
    void speak(spokenReplyText(pendingReplyText)).then(() => {
      if (active) resumeListening();
    });
    return () => {
      active = false;
      cancelSpeech();
    };
  }, [pendingReplyId, pendingReplyText]);

  // oxlint-disable-next-line t3code/react-effect-budget -- releases the microphone and speech engine when the composer unmounts.
  useEffect(
    () => () => {
      sessionRef.current?.cancel();
      if (pauseTimerRef.current !== null) window.clearTimeout(pauseTimerRef.current);
      if (hearingTimerRef.current !== null) window.clearTimeout(hearingTimerRef.current);
      cancelSpeech();
    },
    [],
  );

  if (!isSpeechInputAvailable()) return null;

  const toggleDictation = () => {
    if (listening) {
      sessionRef.current?.stop();
      return;
    }
    startListening("dictate");
  };

  const toggleConversation = () => {
    if (conversation) {
      sessionRef.current?.cancel();
      sessionRef.current = null;
      clearPauseTimer();
      setListening(null);
      setPartial("");
      endConversation();
      return;
    }
    conversationRef.current = true;
    setConversation(true);
    startListening("converse");
  };

  const conversationLabel = conversation
    ? speaking
      ? "Speaking reply… click to end conversation"
      : awaitingReplyAfter !== null
        ? "Waiting for reply… click to end conversation"
        : "Listening… click to end conversation"
    : "Start voice conversation";

  const status = listening
    ? hearing
      ? "You're talking"
      : "Listening…"
    : speaking
      ? "Reading reply…"
      : conversation && awaitingReplyAfter !== null
        ? "Waiting for reply…"
        : null;

  return (
    <>
      {status ? (
        <span
          role="status"
          aria-live="polite"
          data-voice-state={listening ? (hearing ? "hearing" : "listening") : "idle"}
          className={cn(
            "flex h-7 min-w-0 max-w-64 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors duration-150",
            listening && hearing && "border-destructive bg-destructive text-white",
            listening &&
              !hearing &&
              "border-destructive/60 bg-destructive/10 text-destructive-foreground",
            !listening && "border-border text-muted-foreground",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              listening && hearing && "bg-white ring-2 ring-white/40",
              listening && !hearing && "border border-destructive",
              !listening && "bg-muted-foreground/60",
            )}
          />
          <span className="shrink-0 font-medium">{status}</span>
          {listening && partial ? <span className="truncate opacity-80">{partial}</span> : null}
        </span>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-pressed={listening === "dictate" ? "" : undefined}
              disabled={conversation}
              onPointerDown={(event) => event.preventDefault()}
              onClick={toggleDictation}
              aria-label={listening === "dictate" ? "Stop dictation" : "Dictate prompt"}
            />
          }
        >
          <MicIcon />
        </TooltipTrigger>
        <TooltipPopup>{listening === "dictate" ? "Stop dictation" : "Dictate prompt"}</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-pressed={conversation ? "" : undefined}
              disabled={listening === "dictate"}
              onPointerDown={(event) => event.preventDefault()}
              onClick={toggleConversation}
              aria-label={conversationLabel}
            />
          }
        >
          <AudioLinesIcon />
        </TooltipTrigger>
        <TooltipPopup>{conversationLabel}</TooltipPopup>
      </Tooltip>
    </>
  );
}
