import { describe, expect, it } from "vitest";
import { stripMarkdownForSpeech } from "./strip-markdown-for-speech.ts";

describe("stripMarkdownForSpeech", () => {
  it("preserves link text and image alt text while dropping code fences", () => {
    expect(
      stripMarkdownForSpeech(
        "# Summary\nHere is ![a diagram](https://example.com/diagram.png)\n~~~ts\nconst value = 1;\n~~~\nRead [docs](https://example.com).",
      ),
    ).toBe("Summary Here is a diagram Read docs.");
  });
});
