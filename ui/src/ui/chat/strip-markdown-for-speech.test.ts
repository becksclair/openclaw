import { describe, expect, it } from "vitest";
import { stripMarkdownForSpeech } from "./strip-markdown-for-speech.ts";

describe("stripMarkdownForSpeech", () => {
  it("removes speech-hostile markdown wrappers while keeping readable text", () => {
    const result = stripMarkdownForSpeech(
      [
        "# Heading",
        "",
        "- first item",
        "1. second item",
        "[linked text](https://example.com)",
        "![image](https://example.com/image.png)",
        "<b>html</b>",
        "`inline code`",
      ].join("\n"),
    );

    expect(result).toContain("Heading\nfirst item\nsecond item\nlinked text");
    expect(result).toContain("html\ninline code");
    expect(result).not.toContain("https://example.com");
    expect(result).not.toContain("![image]");
  });

  it("preserves underscore-delimited words while still stripping markdown emphasis", () => {
    expect(stripMarkdownForSpeech("use foo_bar_baz and _italic_ text")).toBe(
      "use foo_bar_baz and italic text",
    );
  });
});
