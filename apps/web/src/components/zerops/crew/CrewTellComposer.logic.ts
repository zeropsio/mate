/**
 * *Tell the crew*'s composer (PRD §4.3 item 7, §5.3): `@` offers the crew's
 * crewmates — this composer alone asks `detectComposerTrigger` for them — and
 * a send carries the crewmates the text names as mention nodes, in the order
 * typed. Routing is the engine's: with a lead the message goes to the lead,
 * without one each mention becomes a task, and no mention is refused there.
 */
import type { CrewCommand, Crewmate } from "@t3tools/contracts";

import {
  detectComposerTrigger,
  replaceTextRange,
  type ComposerTrigger,
} from "../../../composer-logic";
import { collectCrewmateMentions } from "../../../composer-editor-mentions";
import type { ComposerCommandItem } from "../../chat/ComposerCommandMenu";

export type CrewmateMenuItem = Extract<ComposerCommandItem, { type: "crewmate" }>;

export interface TellMenu {
  readonly trigger: ComposerTrigger;
  readonly items: ReadonlyArray<CrewmateMenuItem>;
}

/** The crewmate menu under the caret; `null` while the caret is on no `@`. */
export function tellMenu(
  text: string,
  cursor: number,
  crewmates: ReadonlyArray<Crewmate>,
): TellMenu | null {
  const trigger = detectComposerTrigger(text, cursor, { mentions: "crewmate" });
  if (trigger?.kind !== "crewmate") return null;
  const query = trigger.query.toLowerCase();
  const items = crewmates
    .filter(
      (mate) => mate.handle.startsWith(query) || mate.displayName.toLowerCase().startsWith(query),
    )
    .map((mate): CrewmateMenuItem => ({
      id: `crewmate:${mate.handle}`,
      type: "crewmate",
      handle: mate.handle,
      tint: mate.tint,
      label: `@${mate.handle}`,
      description: mate.jobFirstLine,
    }));
  return { trigger, items };
}

/** The typed mention replaced by the picked crewmate's handle, the caret past one space after it. */
export function pickCrewmate(
  text: string,
  trigger: ComposerTrigger,
  handle: string,
): { readonly text: string; readonly cursor: number } {
  const spaced = /\s/u.test(text[trigger.rangeEnd] ?? "");
  const next = replaceTextRange(
    text,
    trigger.rangeStart,
    trigger.rangeEnd,
    spaced ? `@${handle}` : `@${handle} `,
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
