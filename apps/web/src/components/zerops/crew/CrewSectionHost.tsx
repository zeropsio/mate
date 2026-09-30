/**
 * The Crew tab's host (PRD §4.3, seam S6): for the crew the tab read, its
 * column or one of its views in place of it — setup, the goal, a crewmate's
 * job (`useCrewView`: the left menu's ⋯ and the conversation's line ask for
 * them too) — and the commands, drafts, confirmations and the run dialog
 * behind every press. A Mate with no crew yet has its empty state, and *Set
 * up a crew* opens the setup; the setup stays while the crew's copies are
 * made, and becomes the tab once the crew stands.
 *
 * Three command states, so each outcome shows where it was pressed: the
 * column's presses, the composer, and the views.
 *
 * A view slides 24 px in from the right; "‹ Crew" brings the column back from
 * the left. A first paint never moves.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  crewClearConfirm,
  crewDeliverAsk,
  crewNamingTheMate,
  crewPortsAsk,
  crewPortsOfferWords,
  crewRemoveConfirm,
  crewRemoveUnlandedConfirm,
  crewShipLine,
  crewShipWhat,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { CrewCommand, CrewSnapshot, EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { requestConfirmDialog } from "../../../confirmDialog";
import { useServerConfigs } from "../../../state/entities";
import { buildThreadRouteParams } from "../../../threadRoutes";
import { useCrewView, type CrewTabView } from "../../../zerops/crew/crewTab";
import { useCrewCommand } from "../../../zerops/crew/useCrewCommand";
import { useOpenReview } from "../../../zerops/review";
import { ZeropsAskDialog } from "../ZeropsAskDialog";
import { crewDevHosts } from "./CrewEditors.logic";
import { CrewGoal } from "./CrewGoal";
import { CrewLeadPlanBlock, crewPlanPresses } from "./CrewLeadPlan";
import { crewPlanCard } from "./CrewLeadPlan.logic";
import { CrewmateJob } from "./CrewmateJob";
import { CrewRunDialog, type CrewRunDialogAsk } from "./CrewRunDialog";
import { CREW_ORIGIN } from "./CrewRows.logic";
import { CrewSection, CrewSectionEmpty } from "./CrewSection";
import { CrewSetup } from "./CrewSetup";

export interface CrewSectionHostProps {
  readonly environmentId: EnvironmentId;
  readonly snapshot: CrewSnapshot;
  /** `null` while no crew stands. */
  readonly view: CrewView<EnvironmentThreadShell> | null;
  /** The snapshot is current: a press acts on what is shown. */
  readonly current: boolean;
  /** The Mate who lives here: Fen, in its face. */
  readonly mate:
    | { readonly name: string; readonly tint: MateTintId; readonly shape?: MateShapeId }
    | undefined;
  /** The Mate's tree, where the composer's `@` finds files; `null` while unread. */
  readonly treeCwd: string | null;
  /** Hands the Mate a draft, into the chat the tab is open beside when it is a person chat. */
  readonly onAskMate: (draft: string) => void;
}

/** Which of the tab's screens stands: its column, or a view. */
const screenOf = (view: CrewTabView | null): string =>
  view === null ? "column" : view.kind === "job" ? `job:${view.handle ?? "new"}` : view.kind;

export function CrewSectionHost({
  environmentId,
  snapshot,
  view: crew,
  current,
  mate,
  treeCwd,
  onAskMate,
}: CrewSectionHostProps) {
  const commands = useCrewCommand(environmentId);
  const tell = useCrewCommand(environmentId);
  const editorCommands = useCrewCommand(environmentId);
  const navigate = useNavigate();
  const openReview = useOpenReview();
  const providers = useServerConfigs().get(environmentId)?.providers;
  const [view, setView] = useCrewView(environmentId);
  const [runDialog, setRunDialog] = useState<CrewRunDialogAsk | null>(null);
  const [ask, setAsk] = useState<{ readonly ask: string; readonly what: string } | null>(null);
  // The screen before this one, so a change of screen slides and a first paint does not.
  const [shown, setShown] = useState(() => ({
    screen: screenOf(view),
    enter: null as string | null,
  }));
  const screen = screenOf(view);
  if (shown.screen !== screen) {
    setShown({ screen, enter: screen === "column" ? "back" : "forward" });
  }
  const mateName = mate?.name ?? "the Mate";
  const applied = crew !== null;
  const errorAt = (origin: string) => {
    const words = commands.errorAt(origin);
    return words === null ? null : crewNamingTheMate(words, mateName);
  };

  const openThread = useCallback(
    (threadId: ThreadId) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
      });
    },
    [environmentId, navigate],
  );

  const closeView = () => setView(applied || view?.kind === "setup" ? null : { kind: "setup" });

  const clear = (handle: string) => {
    const name = snapshot.crewmates.find((row) => row.handle === handle)?.displayName ?? "";
    void requestConfirmDialog(crewClearConfirm(name))?.then((ok) => {
      if (ok) void commands.send({ _tag: "startFresh", handle }, CREW_ORIGIN.crewmate(handle));
    });
  };

  /**
   * *Remove from the crew* (PRD §5.6): a copy whose work all went in goes
   * with it; one with work not in the Mate's code is kept and the removal
   * refused, and only then is dropping that work offered.
   */
  const remove = (handle: string) => {
    const name = snapshot.crewmates.find((row) => row.handle === handle)?.displayName ?? "";
    void requestConfirmDialog(crewRemoveConfirm(name))?.then(async (ok) => {
      if (!ok) return;
      const origin = CREW_ORIGIN.crewmate(handle);
      const removed = await commands.send(
        { _tag: "removeCrewmate", handle, discardUnlanded: false },
        origin,
      );
      if (removed !== null) {
        setView(null);
        return;
      }
      if (commands.lastRefusal() !== "unlanded-commits") return;
      const drop = await requestConfirmDialog(crewRemoveUnlandedConfirm(name, mateName), {
        variant: "destructive",
      });
      if (!drop) return;
      if (
        (await commands.send({ _tag: "removeCrewmate", handle, discardUnlanded: true }, origin)) !==
        null
      ) {
        setView(null);
      }
    });
  };

  const ship = () => {
    void commands.send({ _tag: "deliverDraft" }, CREW_ORIGIN.deliver).then((result) => {
      if (result?._tag !== "deliverDraft") return;
      setAsk({
        ask: crewDeliverAsk(snapshot, result.dirtyPaths),
        what: `${crewShipWhat(snapshot.landedNotDelivered)} ${crewShipLine(mateName)}`,
      });
    });
  };

  const askPorts = (host: string, count: number) => {
    void editorCommands
      .send({ _tag: "addCrewPorts", host, count: Math.max(1, count) }, CREW_ORIGIN.ports)
      .then((result) => {
        if (result?._tag !== "crewPorts") return;
        setAsk({
          ask: crewPortsAsk(result.host, result.ports),
          what: crewPortsOfferWords(mateName),
        });
      });
  };

  const send = (command: CrewCommand, origin: string) => commands.send(command, origin);
  const run = snapshot.run;
  const plan = crew === null ? null : crewPlanCard(snapshot, crew);

  const body = (() => {
    if (view?.kind === "setup") {
      return (
        <CrewSetup
          applied={applied}
          commands={editorCommands}
          crewmates={snapshot.crewmates}
          devHosts={crewDevHosts(snapshot).map((host) => host.host)}
          hosts={snapshot.hosts}
          mate={{ name: mateName, tint: mate?.tint, shape: mate?.shape }}
          onAsk={(draft, what) => setAsk({ ask: draft, what })}
          onAskPorts={askPorts}
          onClose={() => setView(null)}
          onEditCrewmate={(handle) => setView({ kind: "job", handle })}
        />
      );
    }
    if (view?.kind === "goal") {
      return <CrewGoal applied={applied} commands={editorCommands} onClose={closeView} />;
    }
    if (view?.kind === "job") {
      const target = {
        handle: view.handle,
        lead:
          view.lead === true ||
          snapshot.crewmates.find((row) => row.handle === view.handle)?.kind === "lead",
      };
      return (
        <CrewmateJob
          applied={new Set(snapshot.crewmates.map((row) => row.handle))}
          commands={editorCommands}
          crewPort={snapshot.crewmates.find((row) => row.handle === view.handle)?.app?.port ?? null}
          devHosts={crewDevHosts(snapshot)}
          key={view.handle ?? "new"}
          mateName={mateName}
          mateTint={mate?.tint}
          onClose={closeView}
          onRemove={remove}
          providers={providers}
          target={target}
        />
      );
    }
    if (crew === null) {
      return (
        <CrewSectionEmpty
          mate={{
            name: mateName,
            tint: mate?.tint ?? "amber",
            ...(mate?.shape === undefined ? {} : { shape: mate.shape }),
          }}
          onSetUp={() => setView({ kind: "setup" })}
        />
      );
    }
    return (
      <CrewSection
        busy={!current || commands.pending}
        environmentId={environmentId}
        errorAt={errorAt}
        mateName={mateName}
        onAsk={(draft, what) => setAsk({ ask: draft, what })}
        onHeadMenu={(item) => {
          if (item === "goal") setView({ kind: "goal" });
          else if (item === "addCrewmate") setView({ kind: "job", handle: null });
          else setRunDialog({ mode: "start", after: null });
        }}
        onModePress={(press) => {
          if (press === "letItWork") setRunDialog({ mode: "start", after: null });
          else if (press === "keepGoing") setRunDialog({ mode: "resume", after: null });
          else if (run !== null && press === "stop") {
            void send({ _tag: "stop", runId: run.id }, CREW_ORIGIN.run);
          } else if (run !== null) void send({ _tag: "resume", runId: run.id }, CREW_ORIGIN.run);
        }}
        onOpenThread={openThread}
        onReview={(taskId, from) =>
          openReview({ kind: "crew-task", environmentId, taskId }, { from })
        }
        onRowMenu={(handle, item) => {
          if (item === "job") setView({ kind: "job", handle });
          else if (item === "goal") setView({ kind: "goal" });
          else if (item === "clear") clear(handle);
          else if (item === "remove") remove(handle);
        }}
        onShip={ship}
        renderPlan={(words) =>
          plan === null ? null : (
            <CrewLeadPlanBlock
              busy={!current || commands.pending}
              error={errorAt(CREW_ORIGIN.plan)}
              limits={run?.options ?? null}
              plan={plan}
              presses={crewPlanPresses({ snapshot, plan, send, openRunDialog: setRunDialog })}
              words={words}
            />
          )
        }
        send={send}
        snapshot={snapshot}
        tell={{
          send: (command) => tell.send(command),
          pending: tell.pending,
          error: tell.error === null ? null : crewNamingTheMate(tell.error, mateName),
        }}
        treeCwd={treeCwd}
        view={crew}
      />
    );
  })();

  return (
    <section className="flex flex-1 flex-col" data-zerops-crew>
      <div
        className="crew-view flex flex-1 flex-col"
        data-crew-screen={screen}
        data-enter={shown.enter ?? undefined}
        key={screen}
      >
        {body}
      </div>
      <CrewRunDialog
        ask={runDialog}
        current={current}
        environmentId={environmentId}
        hasLead={crew?.lead != null}
        mateName={mateName}
        onClose={() => setRunDialog(null)}
        onDone={(after) => {
          if (after !== null) void send(after, CREW_ORIGIN.plan);
        }}
        snapshot={crew === null ? null : snapshot}
      />
      <ZeropsAskDialog
        ask={ask?.ask ?? ""}
        mateName={mate?.name}
        onConfirm={() => {
          if (ask === null) return;
          setAsk(null);
          onAskMate(ask.ask);
        }}
        onOpenChange={(open) => {
          if (!open) setAsk(null);
        }}
        open={ask !== null}
        sending={false}
        shape={mate?.shape}
        tint={mate?.tint}
        what={ask?.what ?? ""}
      />
    </section>
  );
}
