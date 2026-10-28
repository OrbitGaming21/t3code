const MAX_SPOKEN_CHARS = 1500;

/** Turns an assistant markdown reply into plain prose worth reading aloud. */
export function spokenReplyText(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(\S[^\n]*?)\1/g, "$2")
    .replace(/^\s*[-*_]{3,}\s*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_SPOKEN_CHARS) return text;
  const cut = text.slice(0, MAX_SPOKEN_CHARS);
  const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return sentenceEnd > MAX_SPOKEN_CHARS / 2 ? cut.slice(0, sentenceEnd + 1) : `${cut}…`;
}

export function isSpeechOutputAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Resolves when speech ends or is cancelled. */
export function speak(text: string): Promise<void> {
  if (!isSpeechOutputAvailable() || text.length === 0) return Promise.resolve();
  window.speechSynthesis.cancel();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

export function cancelSpeech(): void {
  if (isSpeechOutputAvailable()) window.speechSynthesis.cancel();
}
