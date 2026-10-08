/**
 * What a user message asks — the one reading of a message's text that a thread
 * title, the sidebar's "last ask" and the composer's recall all share, on the
 * server and in every client.
 *
 * Not every user message is an ask. A slash command (`/compact`,
 * `/model opus`) is an instruction to the agent's harness, and the
 * usage-limit resume prompt and a crew task card are sent by the server, not
 * the person: none of them titles a thread or becomes the last ask. A message that carries only
 * attachments asks by its attachments, whatever placeholder text the client
 * put in front of them for the agent.
 */
import { messagePictures, pictureWords } from "./composerPictures.ts";
import { messagePreviewText } from "./messagePreview.ts";

/**
 * Text the web client sends in place of an empty prompt when a message carries
 * only attachments: the agent needs words to answer. A title or a preview
 * reads the attachments instead (see {@link userAskOf}).
 */
export const IMAGE_ONLY_BOOTSTRAP_PROMPT =
  "[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]";

/**
 * The message the server sends — never the person — when a usage limit that
 * paused a thread resets and the thread resumes by itself
 * (`OrchestrationThreadShell.usagePause.autoResume`). It is stored as a user
 * message because a provider turn starts from one; a client recognises it with
 * {@link isUsageLimitResumePrompt} and renders it as an event, not as the
 * person's bubble.
 */
export const USAGE_LIMIT_RESUME_PROMPT =
  "[The usage limit has reset. Continue the work that was paused, and answer anything that arrived while you waited.]";

/**
 * The first line of a crew task card: the task the server hands a crewmate
 * (`OrchestrationThreadShell.crew`), written into its thread as a user message
 * because a provider turn starts from one. The card's lines follow it. A
 * client recognises a card with {@link isCrewCard} and renders it as an event,
 * never as the person's bubble. Nothing but this module spells the opener.
 */
export const CREW_CARD_OPENER = "[Crew task card]";

/** The effort prefix `applyClaudePromptEffortPrefix` puts in front of the person's text. */
const EFFORT_PREFIX = "Ultrathink:";

/**
 * `/name`, optionally followed by arguments. Command names come from arbitrary
 * file names (`/deploy.prod`, `/plugin:skill`), so any first token without a
 * second slash is one; an absolute path (`/home/theo/app.ts`) is not.
 */
const SLASH_COMMAND = /^\/[^\s/]+(?:\s|$)/u;

export function isSlashCommand(text: string): boolean {
  return SLASH_COMMAND.test(text.trim());
}

export function isUsageLimitResumePrompt(text: string): boolean {
  return text.trim() === USAGE_LIMIT_RESUME_PROMPT;
}

export function isCrewCard(text: string): boolean {
  return text.trimStart().startsWith(CREW_CARD_OPENER);
}

export type UserAsk =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "attachments"; readonly images: number; readonly files: number };

export interface UserAskSource {
  readonly text: string;
  /** The engine's typed crew card a message opens its run with: the crew wrote it, not the person. */
  readonly crewCard?: unknown;
  /** A picture's kept original is told apart from a file by its type (`@t3tools/shared/composerPictures`). */
  readonly attachments?:
    | ReadonlyArray<{ readonly type: string; readonly mimeType?: string | undefined }>
    | undefined;
}

/**
 * The ask a user message makes, or null when it asks nothing: a slash command,
 * the server's resume prompt or crew task card, or no words and no
 * attachments. Words win over attachments; the effort prefix is not part of
 * what the person typed.
 */
export function userAskOf(message: UserAskSource): UserAsk | null {
  if (message.crewCard !== undefined) return null;
  const trimmed = message.text.trim();
  if (isSlashCommand(trimmed) || isUsageLimitResumePrompt(trimmed) || isCrewCard(trimmed)) {
    return null;
  }
  const attachments = message.attachments ?? [];
  const images = attachments.filter((attachment) => attachment.type === "image").length;
  // A picture's kept original goes with its picture: one picture, not a file.
  const originals = messagePictures(
    trimmed,
    attachments.map((attachment) => ({
      type: attachment.type,
      mimeType: attachment.mimeType ?? "",
    })),
  ).filter((picture) => picture.original !== null).length;
  const files = attachments.length - images - originals;
  // A picture's or a file's label is not something the person wrote; a picture's notes are.
  const words = pictureWords(
    trimmed.startsWith(EFFORT_PREFIX) ? trimmed.slice(EFFORT_PREFIX.length).trim() : trimmed,
    images,
    files,
  );
  if (words.length > 0 && words !== IMAGE_ONLY_BOOTSTRAP_PROMPT) {
    return { kind: "text", text: words };
  }
  if (attachments.length === 0) return null;
  return { kind: "attachments", images, files };
}

/** "1 image", "3 images", "2 files", "1 image and 2 files". */
export function attachmentsLabel(counts: {
  readonly images: number;
  readonly files: number;
}): string {
  const parts = [
    ...(counts.images > 0 ? [countLabel(counts.images, "image")] : []),
    ...(counts.files > 0 ? [countLabel(counts.files, "file")] : []),
  ];
  return parts.join(" and ");
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * A user message as a list row quotes it (`messagePreviewText`), attachments
 * as their count, or null when the message asks nothing a row could quote.
 */
export function userAskPreviewText(message: UserAskSource): string | null {
  const ask = userAskOf(message);
  if (ask === null) return null;
  return ask.kind === "text" ? messagePreviewText(ask.text) : attachmentsLabel(ask);
}
