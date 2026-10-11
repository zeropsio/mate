/**
 * The crewmates the crew home lists that the standing crew doesn't have — saved but never applied,
 * or written there by hand — each to add to the crew or to take out of its home.
 */
import {
  CREW_JOB_WORDS,
  CREW_WAITING_REMOVE,
  crewWaitingWords,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewMemberSpec } from "@t3tools/shared/crewHome";

import { MateFace } from "../primitives";
import { CrewPress } from "./CrewParts";

export function CrewWaiting(props: {
  readonly members: ReadonlyArray<Pick<CrewMemberSpec, "handle" | "displayName" | "tint">>;
  /** `null` while a press is on its way or the viewer may not change the crew. */
  readonly onAdd: (() => void) | null;
  readonly onRemove: ((handle: string) => void) | null;
}) {
  if (props.members.length === 0) return null;
  return (
    <div className="mx-4 mt-4 flex flex-col gap-2" data-crew-waiting>
      {props.members.map((member) => (
        <div className="flex min-h-8 items-center gap-2.5" key={member.handle}>
          <MateFace size="sm" state="idle" tint={member.tint ?? "slate"} />
          <span className="min-w-0 grow truncate text-sm text-muted-foreground">
            {crewWaitingWords(member.displayName)}
          </span>
          <CrewPress
            disabled={props.onAdd === null}
            label={CREW_JOB_WORDS.add}
            onPress={() => props.onAdd?.()}
          />
          <CrewPress
            disabled={props.onRemove === null}
            label={CREW_WAITING_REMOVE}
            onPress={() => props.onRemove?.(member.handle)}
            tone="muted"
          />
        </div>
      ))}
    </div>
  );
}
