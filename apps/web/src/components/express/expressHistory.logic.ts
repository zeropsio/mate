/**
 * What a conversation holds of Adobe Express: the pictures the person saved from the panel, each
 * named by it with the design it came from, and the designs a Mate linked. The panel's history
 * and a design card's picture read it from the conversation, so a reload or another device shows
 * the same.
 */
import type { AssetResource, ChatAttachment } from "@t3tools/contracts";

import { selectMessageImageResources } from "~/session-logic";
import type { ChatMessage } from "~/types";
import { expressDesignId } from "./expressOpen";

type AttachmentResource = Extract<AssetResource, { readonly _tag: "attachment" }>;

export type ExpressHistoryEntry =
  | {
      readonly kind: "picture";
      readonly key: string;
      readonly name: string;
      readonly picture: AttachmentResource;
      /** The untouched file sent beside a picture the composer had to fit: what editing starts from. */
      readonly original: AttachmentResource | undefined;
      /** The design Adobe kept it in; a picture edited without a design has none. */
      readonly documentId: string | undefined;
    }
  | {
      readonly kind: "design";
      readonly key: string;
      readonly documentId: string;
      /** The words the Mate linked it with: its name in the sentence. */
      readonly words: string | undefined;
    };

// A picture answering a Mate's picture ask leads with the ask it answers (`pictureAnswerName`).
const PICTURE_NAME = /^(?:ask-[a-z0-9]+-\d+-)?adobe-express-\d+(?:-(.+))?\.[a-z0-9]+$/iu;

/** The name of a picture saved from the panel: the panel's mark, when, and the design it came from. */
export function expressPictureName(
  documentId: string | undefined,
  extension: string,
  savedAt: number,
): string {
  const design = documentId === undefined ? "" : `-${encodeURIComponent(documentId)}`;
  return `adobe-express-${savedAt}${design}.${extension}`;
}

/** What a picture's name says of where it came from: `null` for one the panel did not save. */
export function expressPictureOrigin(
  name: string,
): { readonly documentId: string | undefined } | null {
  const match = PICTURE_NAME.exec(name);
  if (match === null) return null;
  if (match[1] === undefined) return { documentId: undefined };
  try {
    const documentId = decodeURIComponent(match[1]);
    return { documentId: /^urn:aaid:/iu.test(documentId) ? documentId : undefined };
  } catch {
    return { documentId: undefined };
  }
}

const stemOf = (name: string) => name.replace(/\.[^.]*$/u, "");
const LINK = /\[([^\]]*)\]\((https:\/\/[^)\s]+)\)|https:\/\/[^\s)<>\]]+/gu;

function entriesOf(message: ChatMessage): ReadonlyArray<ExpressHistoryEntry> {
  if (message.role === "user") {
    const attachments: ReadonlyArray<ChatAttachment> = message.attachments ?? [];
    return selectMessageImageResources(attachments).flatMap((picture): ExpressHistoryEntry[] => {
      const attachment = attachments.find((candidate) => candidate.id === picture.attachmentId);
      const origin = attachment === undefined ? null : expressPictureOrigin(attachment.name);
      if (attachment === undefined || origin === null) return [];
      const kept = attachments.find(
        (candidate) =>
          candidate.type === "file" && stemOf(candidate.name) === stemOf(attachment.name),
      );
      return [
        {
          kind: "picture",
          key: `picture:${attachment.id}`,
          name: attachment.name,
          picture,
          original:
            kept === undefined
              ? undefined
              : { _tag: "attachment", attachmentId: kept.id, mimeType: kept.mimeType },
          documentId: origin.documentId,
        },
      ];
    });
  }
  // A link still being written is read once its message is done, not on each word.
  if (message.role !== "assistant" || message.streaming) return [];
  return [...message.text.matchAll(LINK)].flatMap((match): ExpressHistoryEntry[] => {
    const documentId = expressDesignId(match[2] ?? match[0]);
    if (documentId === null) return [];
    const words = match[1]?.trim() || undefined;
    return [{ kind: "design", key: `design:${documentId}:${words ?? ""}`, documentId, words }];
  });
}

// A conversation's messages keep their identity until they change: only a changed one is read again.
const read = new WeakMap<ChatMessage, ReadonlyArray<ExpressHistoryEntry>>();

/** Two histories list the same entries in the same order: an entry's key names all of it. */
const sameHistory = (
  left: ReadonlyArray<ExpressHistoryEntry>,
  right: ReadonlyArray<ExpressHistoryEntry>,
): boolean =>
  left.length === right.length && left.every((entry, index) => entry.key === right[index]!.key);

/**
 * Newest first, each design once: its newest picture stands for it, else the Mate's newest link
 * to it. The same history as `held` is `held` itself, so what draws it does not draw again.
 */
export function expressHistoryOf(
  messages: ReadonlyArray<ChatMessage>,
  held?: ReadonlyArray<ExpressHistoryEntry>,
): ReadonlyArray<ExpressHistoryEntry> {
  const history: ExpressHistoryEntry[] = [];
  const designAt = new Map<string, number>();
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    let entries = read.get(message);
    if (entries === undefined) {
      entries = entriesOf(message);
      read.set(message, entries);
    }
    for (let at = entries.length - 1; at >= 0; at--) {
      const entry = entries[at]!;
      if (entry.documentId === undefined) {
        history.push(entry);
        continue;
      }
      const seen = designAt.get(entry.documentId);
      if (seen === undefined) {
        designAt.set(entry.documentId, history.length);
        history.push(entry);
      } else if (history[seen]!.kind === "design" && entry.kind === "picture") {
        history[seen] = entry;
      }
    }
  }
  return held !== undefined && sameHistory(held, history) ? held : history;
}
