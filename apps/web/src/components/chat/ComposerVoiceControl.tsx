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

// Conversation mode sends once you pause this long after speaking.
const CONVERSATION_PAUSE_MS = 1600;

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
  const sessionRef = useRef<SpeechInputSession | null>(null);
  const pauseTimerRef = useRef<number | null>(null);
  const conversationRef = useRef(false);

  const clearPauseTimer = () => {
    if (pauseTimerRef.current !== null) window.clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = null;
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
          if (mode !== "converse" || text.trim().length === 0) return;
          clearPauseTimer();
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

  return (
    <>
      {listening && partial ? (
        <span className="max-w-48 truncate text-muted-foreground text-xs" aria-live="polite">
          {partial}
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
