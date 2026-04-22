import { stripMarkdown as stripSharedMarkdown } from "../../../../src/shared/text/strip-markdown.ts";

export function stripMarkdownForSpeech(text: string): string {
  return stripSharedMarkdown(
    text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
