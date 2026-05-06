const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const INLINE_CODE_RE = /`([^`]+)`/g;
const CODE_FENCE_RE = /(?:```|~~~)[\s\S]*?(?:```|~~~)/g;
const HTML_TAG_RE = /<[^>]+>/g;

export function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(CODE_FENCE_RE, " ")
    .replace(MARKDOWN_IMAGE_RE, "$1")
    .replace(MARKDOWN_LINK_RE, "$1")
    .replace(INLINE_CODE_RE, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[\s>*-]+/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(HTML_TAG_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}
