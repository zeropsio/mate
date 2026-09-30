/**
 * The Crew tab's composer (PRD §4.3 item 7, §5.3): what you give the crew to
 * do. With a lead it goes to the lead, who splits it and shows you the plan;
 * without one, to the crewmates you pick by their faces — each gets it as a
 * task of its own. `@` finds the files of the Mate's tree, as a chat's does;
 * nobody is ever named by a handle.
 */
import type { CrewCommand, Crewmate } from "@t3tools/contracts";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";

import {
  detectComposerTrigger,
  replaceTextRange,
  type ComposerTrigger,
} from "../../../composer-logic";
import type { ComposerCommandItem } from "../../chat/ComposerCommandMenu";

export type TellMenuItem = Extract<ComposerCommandItem, { type: "path" }>;

export interface TellMenu {
  readonly trigger: ComposerTrigger;
  readonly items: ReadonlyArray<TellMenuItem>;
}

/** A file or directory the path search found for the typed query. */
export interface TellFile {
  readonly path: string;
  readonly kind: "file" | "directory";
}

/**
 * The crewmates a typed `@` query names, by handle or name — what the lead's
 * chat offers after `@` (its composer's own menu).
 */
export function crewmateMenuItems(
  crewmates: ReadonlyArray<Crewmate>,
  query: string,
): ReadonlyArray<Extract<ComposerCommandItem, { type: "crewmate" }>> {
  const typed = query.toLowerCase();
  return crewmates
    .filter(
      (mate) => mate.handle.startsWith(typed) || mate.displayName.toLowerCase().startsWith(typed),
    )
    .map((mate) => ({
      id: `crewmate:${mate.handle}`,
      type: "crewmate",
      handle: mate.handle,
      tint: mate.tint,
      label: `@${mate.handle}`,
      description: mate.jobFirstLine,
    }));
}

/** The files under the caret's `@`, or `null` while the caret is on no `@`. */
export function tellMenu(
  text: string,
  cursor: number,
  files: ReadonlyArray<TellFile>,
): TellMenu | null {
  const trigger = detectComposerTrigger(text, cursor, { mentions: "crewmate" });
  if (trigger?.kind !== "crewmate") return null;
  return {
    trigger,
    items: files.map((file): TellMenuItem => ({
      id: `path:${file.kind}:${file.path}`,
      type: "path",
      path: file.path,
      pathKind: file.kind,
      label: file.path.slice(file.path.lastIndexOf("/") + 1),
      description: file.path.slice(0, Math.max(0, file.path.lastIndexOf("/"))),
    })),
  };
}

/** The typed `@` replaced by the picked file's link, as a chat writes it, the caret past one space. */
export function pickTellItem(
  text: string,
  trigger: ComposerTrigger,
  item: TellMenuItem,
): { readonly text: string; readonly cursor: number } {
  const token = serializeComposerFileLink(item.path);
  const spaced = /\s/u.test(text[trigger.rangeEnd] ?? "");
  const next = replaceTextRange(
    text,
    trigger.rangeStart,
    trigger.rangeEnd,
    spaced ? token : `${token} `,
  );
  return spaced ? { text: next.text, cursor: next.cursor + 1 } : next;
}

/** Without a lead: a face pressed joins the message's crewmates, or leaves them, in the crew's order. */
export function tellPicks(
  picked: ReadonlyArray<string>,
  handle: string,
  crewmates: ReadonlyArray<Pick<Crewmate, "handle">>,
): ReadonlyArray<string> {
  const next = picked.includes(handle)
    ? picked.filter((each) => each !== handle)
    : [...picked, handle];
  return crewmates.map((mate) => mate.handle).filter((each) => next.includes(each));
}

/** The `tell` command for a send — to the lead, or to the crewmates picked; `null` for nothing to send. */
export function tellPayload(
  text: string,
  picked: ReadonlyArray<string>,
): Extract<CrewCommand, { _tag: "tell" }> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return { _tag: "tell", text: trimmed, mentions: picked.map((handle) => ({ handle })) };
}
