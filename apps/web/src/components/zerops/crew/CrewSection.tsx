/**
 * The Crew tab's column, as the "Mate Crew Tab" board draws it: the goal and
 * how the crew works (`CrewHead`), the composer that gives it something to do
 * (`CrewTellComposer`), a row per crewmate (`CrewRows`), and the work that went
 * into the Mate's code (`CrewInFensCode`). `CrewSectionEmpty` is a Mate with no
 * crew yet: the Mate, three seats waiting, and *Set up a crew*.
 *
 * Presentational: every press is a callback, so the host (`CrewSectionHost`)
 * owns the commands, the views and the dialogs.
 */
import {
  CREW_SET_UP_LINE,
  CREW_SET_UP_WORD,
  crewGiveCrewLine,
  crewGiveCrewTitle,
  crewNamingTheMate,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type {
  CrewCommand,
  CrewCommandResult,
  CrewSnapshot,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { mateMarkStateForThreadStatus } from "@t3tools/shared/threadStatus";
import type { ReactNode } from "react";

import { MateFace } from "../primitives";
import { CrewHead, type CrewHeadMenuItem } from "./CrewHead";
import { crewModeLine, type CrewModePressKind } from "./CrewHead.logic";
import { CrewInFensCode } from "./CrewInFensCode";
import type { CrewmateMenuItemId } from "./CrewmateMenu.logic";
import { CrewPress } from "./CrewParts";
import { CrewRows } from "./CrewRows";
import { CREW_ORIGIN } from "./CrewRows.logic";
import { CrewTellComposer } from "./CrewTellComposer";

export function CrewSectionEmpty({
  mate,
  onSetUp,
}: {
  readonly mate: { readonly name: string; readonly tint: MateTintId; readonly shape?: MateShapeId };
  readonly onSetUp: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-12 pt-49 text-center" data-crew-section="none">
      <div className="flex items-center gap-2.5">
        <MateFace className="size-10" shape={mate.shape} size="lg" state="idle" tint={mate.tint} />
        <span className="flex items-center gap-1.5" aria-hidden="true">
          <span className="crew-seat" />
          <span className="crew-seat" />
          <span className="crew-seat" />
        </span>
      </div>
      <h2 className="mt-5 font-semibold text-base leading-6">{crewGiveCrewTitle(mate.name)}</h2>
      <p className="mt-1.5 max-w-100 text-muted-foreground text-sm leading-5.5">
        {crewGiveCrewLine(mate.name)}
      </p>
      <div className="mt-5">
        <CrewPress label={CREW_SET_UP_WORD} line={CREW_SET_UP_LINE} onPress={onSetUp} size="view" />
      </div>
    </div>
  );
}

export interface CrewSectionProps {
  readonly environmentId: EnvironmentId;
  readonly snapshot: CrewSnapshot;
  readonly view: CrewView<EnvironmentThreadShell>;
  readonly mateName: string;
  /** The Mate's tree, where the composer's `@` finds files; `null` while unread. */
  readonly treeCwd: string | null;
  /** A press of the tab's is on its way, or the crew is not current. */
  readonly busy: boolean;
  /** The last refusal's sentence at `origin` (`CREW_ORIGIN`), naming the Mate. */
  readonly errorAt: (origin: string) => string | null;
  readonly send: (command: CrewCommand, origin: string) => Promise<CrewCommandResult | null>;
  /** The composer's own sends, so its refusal stays under it. */
  readonly tell: {
    readonly send: (command: CrewCommand) => Promise<CrewCommandResult | null>;
    readonly pending: boolean;
    readonly error: string | null;
  };
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onReview: (taskId: string, from: HTMLElement) => void;
  /** Hands the Mate a draft, confirmed first: `what` says why. */
  readonly onAsk: (ask: string, what: string) => void;
  readonly onShip: () => void;
  readonly onHeadMenu: (item: CrewHeadMenuItem) => void;
  readonly onModePress: (press: CrewModePressKind) => void;
  readonly onRowMenu: (handle: string, item: CrewmateMenuItemId) => void;
  /** The lead's plan, in its row. */
  readonly renderPlan: (leadWords: string | null) => ReactNode;
}

export function CrewSection(props: CrewSectionProps) {
  const { snapshot, view } = props;
  const run = snapshot.run;
  const mode = crewModeLine({ run, workingCount: view.workingCount, tasks: snapshot.board.tasks });
  const engineError =
    snapshot.lastError === null ? null : crewNamingTheMate(snapshot.lastError, props.mateName);
  const lead = view.lead;
  return (
    <section className="flex flex-col pb-6" data-crew-section="applied">
      <CrewHead
        crew={snapshot.crew ?? { briefTitle: "", briefExcerpt: "" }}
        error={props.errorAt(CREW_ORIGIN.run) ?? engineError}
        letItWork={run === null || run.state === "finished" || run.state === "stopped"}
        mode={mode}
        onGoal={() => props.onHeadMenu("goal")}
        onMenu={props.onHeadMenu}
        onModePress={props.onModePress}
      />
      <CrewTellComposer
        crewmates={snapshot.crewmates.filter((mate) => mate.kind !== "lead")}
        environmentId={props.environmentId}
        error={props.tell.error}
        lead={
          lead === null
            ? null
            : {
                name: lead.crewmate.displayName,
                tint: lead.crewmate.tint,
                face:
                  lead.status === null ? "idle" : mateMarkStateForThreadStatus(lead.status.kind),
              }
        }
        onSend={async (command) => (await props.tell.send(command)) !== null}
        planWaits={snapshot.board.tasks.some((task) => task.state === "proposed")}
        sending={props.tell.pending}
        treeCwd={props.treeCwd}
      />
      <CrewRows
        busy={props.busy}
        environmentId={props.environmentId}
        errorAt={props.errorAt}
        mateName={props.mateName}
        onAsk={props.onAsk}
        onCommand={props.send}
        onMenu={props.onRowMenu}
        onOpenThread={props.onOpenThread}
        onReview={props.onReview}
        renderPlan={props.renderPlan}
        snapshot={snapshot}
        view={view}
      />
      <CrewInFensCode
        crewmates={snapshot.crewmates}
        error={props.errorAt(CREW_ORIGIN.deliver)}
        mateName={props.mateName}
        notShipped={snapshot.landedNotDelivered}
        onReview={props.onReview}
        onShip={props.onShip}
        tasks={snapshot.board.tasks}
      />
    </section>
  );
}
