/**
 * *Tell the crew*'s composer (PRD §4.3 item 7, §5.3): `@` offers the crew's
 * crewmates — this composer alone asks `detectComposerTrigger` for them — and
 * then the files of your tree, as a chat's `@` does; a send carries the
 * crewmates the text names as mention nodes, in the order typed. Routing is
 * the engine's: with a lead the message goes to the lead, without one each
 * mention becomes a task, and no mention is refused there.
 */
import type { CrewCommand, Crewmate } from "@t3tools/contracts";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";

import {
  detectComposerTrigger,
  replaceTextRange,
  type ComposerTrigger,
} from "../../../composer-logic";
import { collectCrewmateMentions } from "../../../composer-editor-mentions";
import type { ComposerCommandItem } from "../../chat/ComposerCommandMenu";

export type TellMenuItem = Extract<ComposerCommandItem, { type: "crewmate" | "path" }>;

export interface TellMenu {
  readonly trigger: ComposerTrigger;
  readonly items: ReadonlyArray<TellMenuItem>;
}

/** A file or directory the path search found for the typed query. */
export interface TellFile {
  readonly path: string;
  readonly kind: "file" | "directory";
}

/** The menu under the caret — crewmates first, then `files` — or `null` while the caret is on no `@`. */
export function tellMenu(
  text: string,
  cursor: number,
  crewmates: ReadonlyArray<Crewmate>,
  files: ReadonlyArray<TellFile>,
): TellMenu | null {
  const trigger = detectComposerTrigger(text, cursor, { mentions: "crewmate" });
  if (trigger?.kind !== "crewmate") return null;
  const query = trigger.query.toLowerCase();
  const mates = crewmates
    .filter(
      (mate) => mate.handle.startsWith(query) || mate.displayName.toLowerCase().startsWith(query),
    )
    .map((mate): TellMenuItem => ({
      id: `crewmate:${mate.handle}`,
      type: "crewmate",
      handle: mate.handle,
      tint: mate.tint,
      label: `@${mate.handle}`,
      description: mate.jobFirstLine,
    }));
  const paths = files.map((file): TellMenuItem => ({
    id: `path:${file.kind}:${file.path}`,
    type: "path",
    path: file.path,
    pathKind: file.kind,
    label: file.path.slice(file.path.lastIndexOf("/") + 1),
    description: file.path.slice(0, Math.max(0, file.path.lastIndexOf("/"))),
  }));
  return { trigger, items: [...mates, ...paths] };
}

/**
 * The typed mention replaced by the picked item — a crewmate's `@handle`, a
 * file's link as a chat writes it — the caret past one space after it.
 */
export function pickTellItem(
  text: string,
  trigger: ComposerTrigger,
  item: TellMenuItem,
): { readonly text: string; readonly cursor: number } {
  const token = item.type === "crewmate" ? `@${item.handle}` : serializeComposerFileLink(item.path);
  const spaced = /\s/u.test(text[trigger.rangeEnd] ?? "");
  const next = replaceTextRange(
    text,
    trigger.rangeStart,
    trigger.rangeEnd,
    spaced ? token : `${token} `,
  );
  return spaced ? { text: next.text, cursor: next.cursor + 1 } : next;
}

/** The `tell` command for a send; `null` for nothing to send. */
export function tellPayload(
  text: string,
  crewmates: ReadonlyArray<Crewmate>,
): Extract<CrewCommand, { _tag: "tell" }> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const mentions = collectCrewmateMentions(
    trimmed,
    crewmates.map((mate) => mate.handle),
  ).map((mention) => ({ handle: mention.path }));
  return { _tag: "tell", text: trimmed, mentions };
}
