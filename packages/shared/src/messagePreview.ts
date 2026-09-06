/**
 * The opening words of a chat message, the way a list row quotes them: one
 * line, markdown's marks dropped, cut at a word well within
 * `MESSAGE_PREVIEW_MAX_LENGTH` characters. The server stores this on the
 * thread shell (`OrchestrationThreadShell.latestMessagePreview`) so a row
 * that lists conversations can say what was last said without loading a
 * single message.
 */
export const MESSAGE_PREVIEW_MAX_LENGTH = 160;

const FENCE_LINE = /^\s{0,3}(?:`{3,}|~{3,}).*$/gmu;
const HORIZONTAL_RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gmu;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/gu;
const LINK = /\[([^\]]+)\]\([^)]*\)/gu;
const STRONG = /(\*\*|__)(?=\S)([^\n]*?\S)\1/gu;
const EMPHASIS = /(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/gu;
const STRIKE = /~~(?=\S)([^\n]*?\S)~~/gu;
const CODE = /`([^`\n]+)`/gu;
const BLOCK_MARKS = /^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,3}[.)]\s+)/gmu;
const TRAILING_PUNCTUATION = /[\s,;:.!?…-]+$/u;

/** A markdown message as plain words, or null when nothing is left to quote. */
export function messagePreviewText(markdown: string): string | null {
  const words = markdown
    .replace(FENCE_LINE, "")
    .replace(HORIZONTAL_RULE, "")
    .replace(IMAGE, "$1")
    .replace(LINK, "$1")
    .replace(STRONG, "$2")
    .replace(EMPHASIS, "$1$2")
    .replace(STRIKE, "$1")
    .replace(CODE, "$1")
    .replace(BLOCK_MARKS, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (words.length === 0) return null;
  return truncateAtWord(words, MESSAGE_PREVIEW_MAX_LENGTH);
}

function truncateAtWord(text: string, maxLength: number): string {
  const characters = Array.from(text);
  if (characters.length <= maxLength) return text;
  const cut = characters.slice(0, maxLength).join("");
  const lastSpace = cut.lastIndexOf(" ");
  const atWord = lastSpace >= maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${atWord.replace(TRAILING_PUNCTUATION, "")}…`;
}
