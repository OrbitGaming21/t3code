import { describe, expect, it } from "vite-plus/test";

import { parseDictationLine } from "./dictation.ts";

describe("parseDictationLine", () => {
  it("decodes helper events", () => {
    expect(parseDictationLine('{"type":"ready"}')).toEqual({ type: "ready" });
    expect(parseDictationLine('{"type":"partial","text":"hello"}')).toEqual({
      type: "partial",
      text: "hello",
    });
    expect(parseDictationLine('{"type":"final","text":"hello there"}')).toEqual({
      type: "final",
      text: "hello there",
    });
    expect(parseDictationLine('{"type":"error","message":"No microphone"}')).toEqual({
      type: "error",
      message: "No microphone",
    });
  });

  it("ignores malformed and unknown lines", () => {
    expect(parseDictationLine("not json")).toBeNull();
    expect(parseDictationLine('{"type":"other"}')).toBeNull();
    expect(parseDictationLine("null")).toBeNull();
  });
});
