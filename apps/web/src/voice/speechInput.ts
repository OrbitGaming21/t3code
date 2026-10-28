import type { DesktopDictationEvent } from "@t3tools/contracts";

export type SpeechInputHandlers = {
  readonly onPartial: (text: string) => void;
  readonly onFinal: (text: string) => void;
  readonly onError: (message: string) => void;
};

export type SpeechInputSession = {
  readonly stop: () => void;
  readonly cancel: () => void;
};

// The DOM lib does not ship SpeechRecognition types; this is the subset we use.
interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function browserRecognition(): BrowserSpeechRecognitionConstructor | null {
  // Electron's Chromium exposes the API but it needs a Google key, so desktop uses the bridge.
  if (window.desktopBridge) return null;
  const scope = window as unknown as {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function isSpeechInputAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return window.desktopBridge?.dictation !== undefined || browserRecognition() !== null;
}

function browserErrorMessage(error: string): string {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Allow microphone access for this site to use voice input.";
  }
  if (error === "audio-capture") return "No microphone is available.";
  return "Could not recognize speech.";
}

export function startSpeechInput(
  handlers: SpeechInputHandlers,
  locale?: string,
): SpeechInputSession | null {
  const dictation = window.desktopBridge?.dictation;
  if (dictation) {
    let done = false;
    const unsubscribe = dictation.onEvent((event: DesktopDictationEvent) => {
      if (done) return;
      if (event.type === "partial") handlers.onPartial(event.text);
      else if (event.type === "final") {
        done = true;
        unsubscribe();
        handlers.onFinal(event.text);
      } else if (event.type === "error") {
        done = true;
        unsubscribe();
        handlers.onError(event.message);
      }
    });
    void dictation.start(locale ? { locale } : {});
    return {
      stop: () => void dictation.stop({}),
      cancel: () => {
        done = true;
        unsubscribe();
        void dictation.stop({ cancel: true });
      },
    };
  }

  const Recognition = browserRecognition();
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  if (locale) recognition.lang = locale;
  let finalText = "";
  let failed = false;
  let cancelled = false;
  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]!;
      const transcript = result[0]?.transcript ?? "";
      if (result.isFinal) finalText = `${finalText} ${transcript}`.trim();
      else interim += transcript;
    }
    handlers.onPartial(`${finalText} ${interim}`.trim());
  };
  recognition.onerror = (event) => {
    if (cancelled || event.error === "aborted") return;
    if (event.error === "no-speech") return;
    failed = true;
    handlers.onError(browserErrorMessage(event.error));
  };
  recognition.onend = () => {
    if (!failed && !cancelled) handlers.onFinal(finalText);
  };
  recognition.start();
  return {
    stop: () => recognition.stop(),
    cancel: () => {
      cancelled = true;
      recognition.abort();
    },
  };
}
