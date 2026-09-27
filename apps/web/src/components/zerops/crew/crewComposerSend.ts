/**
 * A crew thread's composer. Where its send goes (PRD §5.2a): a crewmate's chat
 * never starts a turn of its own — its send is a `message` to the crew engine,
 * which opens the implicit task, admits the turn against the crewmate's login
 * and dispatches it or holds it behind the current task; a thread without a
 * crew origin — a person's chat — keeps its own turn. And whom its `@` offers
 * (PRD §5.3).
 */
import type { CrewmateView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { ChatAttachment, CrewCommand, Crewmate, ThreadCrewOrigin } from "@t3tools/contracts";

export type CrewMessageCommand = Extract<CrewCommand, { readonly _tag: "message" }>;

/** The crew engine's `message` for a crew thread's send; `null` for any other thread. */
export function crewMessageCommand(
  shell: { readonly crew?: ThreadCrewOrigin | null | undefined } | null | undefined,
  message: { readonly text: string; readonly attachments: ReadonlyArray<ChatAttachment> },
): CrewMessageCommand | null {
  const origin = shell?.crew;
  if (origin == null) return null;
  return {
    _tag: "message",
    handle: origin.crewmate,
    text: message.text,
    attachments: message.attachments,
  };
}

/**
 * Whom `@` offers in a chat (PRD §5.3): the lead's chat offers the other
 * crewmates — a mention travels in the message's text, and the engine reads
 * whom it addresses — while a crewmate's chat and a person's chat offer none
 * (`undefined`), their `@` keeping to files and data.
 */
export function crewComposerMentions(
  row: Pick<CrewmateView, "crewmate"> | null,
  crewmates: ReadonlyArray<Crewmate>,
): ReadonlyArray<Crewmate> | undefined {
  if (row === null || row.crewmate.kind !== "lead") return undefined;
  return crewmates.filter((mate) => mate.handle !== row.crewmate.handle);
}
