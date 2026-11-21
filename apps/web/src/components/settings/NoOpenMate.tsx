import { Button } from "../ui/button";
import type { MatesWithoutOpenMate } from "./NoOpenMate.logic";
import { SettingsRow, SettingsSection } from "./settingsLayout";

/** What each state's line says on the page: what the page reads from a Mate. */
export interface NoOpenMateWords {
  readonly finding: string;
  readonly connecting: string;
  readonly none: string;
  readonly notOpen: string;
}

/** Each Mate holds what the page shows: with none open, the way on is to open one. */
export function NoOpenMate({
  setting,
  words,
  state,
  onOpen,
}: {
  readonly setting: { readonly id: string; readonly title: string };
  readonly words: NoOpenMateWords;
  readonly state: MatesWithoutOpenMate;
  readonly onOpen: (projectId: string) => void;
}) {
  // No spinner while finding or connecting: either can last, and a repainting
  // animation would run the whole time.
  if (state.kind !== "open") {
    return (
      <SettingsSection {...setting}>
        <SettingsRow
          title={state.kind === "finding" ? "Finding your Mates" : "Connecting to your Mates"}
          description={state.kind === "finding" ? words.finding : words.connecting}
        />
      </SettingsSection>
    );
  }
  return (
    <SettingsSection {...setting}>
      <SettingsRow
        title={state.mates.length === 0 ? "No Mates yet" : "No Mate open"}
        description={state.mates.length === 0 ? words.none : words.notOpen}
      />
      {state.mates.map((mate) => (
        <SettingsRow
          key={mate.projectId}
          title={mate.name}
          description={mate.project}
          control={
            <Button
              aria-label={`Open ${mate.name}`}
              size="sm"
              variant="secondary"
              onClick={() => onOpen(mate.projectId)}
            >
              Open
            </Button>
          }
        />
      ))}
    </SettingsSection>
  );
}
