/**
 * Who said a task's follow-up and where, in the reader's words: "You answered on the Board", "Ines
 * replied in the Slack thread", "ida-ops commented on the issue" — the place named as its source
 * names it, and where it has an address, that place is the link (`MateTaskMessageRow`).
 */
import type { MateTaskMessage, MateTaskSource } from "@t3tools/contracts";

/** Where the place in a follow-up's heading leads. */
export type TaskMessagePlace =
  /** The task's panel on its application's Board. */
  | { readonly kind: "board" }
  /** Where the task came from, outside Mate: its issue, its thread. */
  | { readonly kind: "url"; readonly url: string }
  /** Nowhere to go: the words alone. */
  | { readonly kind: "none" };

export interface TaskMessageOrigin {
  /** The reader themself, a person by name, or nobody named. */
  readonly by:
    | { readonly kind: "you" }
    | { readonly kind: "named"; readonly name: string }
    | { readonly kind: "someone" };
  readonly act: "answered" | "replied" | "commented" | "edited";
  readonly where: "board" | "issue" | "slack-thread" | "discord-thread" | "change" | "task";
  readonly to: TaskMessagePlace;
}

/**
 * Where something said about a task after its Mate took it came from. Its author is the reader
 * where the name is one the reader goes by (`viewer`: a follow-up carries its author's name, never
 * their id). An answer to a task asked from the Board, a conversation, a webhook or a schedule was
 * given on the Board, the one place such a task is answered.
 */
export function taskMessageOrigin(
  message: Pick<MateTaskMessage, "from" | "author">,
  source: MateTaskSource | null,
  viewer: ReadonlyArray<string>,
): TaskMessageOrigin {
  const author = message.author?.trim() ?? "";
  const by: TaskMessageOrigin["by"] =
    author === ""
      ? { kind: "someone" }
      : viewer.includes(author)
        ? { kind: "you" }
        : { kind: "named", name: author };
  const none = { kind: "none" } as const;
  switch (message.from) {
    case "review":
      return { by, act: "commented", where: "change", to: none };
    case "edit":
      return source?.kind === "github-issue"
        ? { by, act: "edited", where: "issue", to: { kind: "url", url: source.url } }
        : { by, act: "edited", where: "task", to: none };
    case "comment":
    case "reply":
      switch (source?.kind) {
        case "github-issue":
          return { by, act: "commented", where: "issue", to: { kind: "url", url: source.url } };
        case "slack-thread":
        case "discord-thread":
          return { by, act: "replied", where: source.kind, to: { kind: "url", url: source.url } };
        default:
          return { by, act: "answered", where: "board", to: { kind: "board" } };
      }
  }
}

/** The place's words after the act, the part of the heading that is its link. */
const PLACE_WORDS: Readonly<Record<TaskMessageOrigin["where"], string>> = {
  board: "on the Board",
  issue: "on the issue",
  "slack-thread": "in the Slack thread",
  "discord-thread": "in the Discord thread",
  change: "on the change",
  task: "the task",
};

/** The heading in words: "You answered" and its place, "on the Board". */
export function taskMessageWords(origin: TaskMessageOrigin): {
  readonly lead: string;
  readonly place: string;
} {
  const who =
    origin.by.kind === "you" ? "You" : origin.by.kind === "named" ? origin.by.name : "Someone";
  return {
    lead: `${who} ${origin.act}`,
    place:
      origin.act === "edited" && origin.where === "issue" ? "the issue" : PLACE_WORDS[origin.where],
  };
}
