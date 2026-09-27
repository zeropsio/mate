/**
 * Where a composer's send goes (PRD §5.2a). A crewmate's chat never starts a
 * turn of its own: its send is a `message` to the crew engine, which opens the
 * implicit task, admits the turn against the crewmate's login and dispatches
 * it or holds it behind the current task. A thread without a crew origin — a
 * person's chat — keeps its own turn.
 */
import type { ChatAttachment, CrewCommand, ThreadCrewOrigin } from "@t3tools/contracts";

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
