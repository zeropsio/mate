/**
 * The crew's section in the Crew tab (PRD §4.3, seam S6): owns its commands,
 * its editors and its drafts for Fen, for the crew the tab read — the empty
 * state and *Set up a crew* while there is none, the section once one is
 * applied. The setup sheet stays mounted across Apply, so its progress reads
 * on as the crew arrives. The Mate's menu in the left menu can ask for it
 * before the tab draws (`crewTab.ts`); the tab opens it as it draws.
 *
 * Three command states, so each outcome shows where it was pressed: the
 * section's presses, *Tell the crew*, and the editors.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  crewDeliverAsk,
  crewNamingTheMate,
  crewPortsAsk,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { CrewmateView, CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { CrewSnapshot, EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { requestConfirmDialog } from "../../../confirmDialog";
import { buildThreadRouteParams } from "../../../threadRoutes";
import { useCrewSetupSheet } from "../../../zerops/crew/crewTab";
import { useCrewCommand } from "../../../zerops/crew/useCrewCommand";
import { ZeropsAskDialog } from "../ZeropsAskDialog";
import { CrewBriefSheet } from "./CrewBriefSheet";
import { crewDevHosts } from "./CrewEditors.logic";
import { CREW_ORIGIN } from "./CrewSection.logic";
import { CrewSection, CrewSectionEmpty } from "./CrewSection";
import { CrewmateEditor } from "./CrewmateEditor";
import type { CrewmateSheetTarget } from "./CrewmateSheet";
import { CrewPortsDialog } from "./CrewPortsDialog";
import { CrewRunDialog } from "./CrewRunDialog";
import { CrewSetupSheet } from "./CrewSetupSheet";

type Editor =
  | { readonly kind: "brief" }
  | { readonly kind: "crewmate"; readonly target: CrewmateSheetTarget }
  | null;

export interface CrewSectionHostProps {
  readonly environmentId: EnvironmentId;
  readonly snapshot: CrewSnapshot;
  /** `null` while no crew is applied. */
  readonly view: CrewView<EnvironmentThreadShell> | null;
  /** The Mate who lives here: Fen, in its tint. */
  readonly mate: { readonly name: string; readonly tint: MateTintId } | undefined;
  /** Your tree, where *Tell the crew*'s `@` finds files; `null` while unread. */
  readonly treeCwd: string | null;
  /** Hands Fen a draft, into the chat the tab is open beside when it is a person chat. */
  readonly onAskMate: (draft: string) => void;
  /** Brings the board under the section into view; `null` while there is none. */
  readonly onShowBoard: (() => void) | null;
}

export function CrewSectionHost({
  environmentId,
  snapshot,
  view,
  mate,
  treeCwd,
  onAskMate,
  onShowBoard,
}: CrewSectionHostProps) {
  const commands = useCrewCommand(environmentId);
  const tell = useCrewCommand(environmentId);
  const editorCommands = useCrewCommand(environmentId);
  const navigate = useNavigate();
  // Opened here, or asked for by the Mate's menu in the left menu.
  const [setupOpen, setSetupOpen] = useCrewSetupSheet(environmentId);
  const [editor, setEditor] = useState<Editor>(null);
  const [homeVersion, setHomeVersion] = useState(0);
  const [portsHost, setPortsHost] = useState<string | null>(null);
  /** The run dialog: to start a run, or to resume one its limit paused. */
  const [runDialog, setRunDialog] = useState<"start" | "resume" | null>(null);
  const [ask, setAsk] = useState<{ readonly ask: string; readonly what: string } | null>(null);
  const mateName = mate?.name ?? "the Mate";
  const devHosts = crewDevHosts(snapshot).map((host) => host.host);

  const openThread = useCallback(
    (threadId: ThreadId) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
      });
    },
    [environmentId, navigate],
  );

  const closeEditor = (open: boolean) => {
    if (open) return;
    setEditor(null);
    setHomeVersion((value) => value + 1);
  };

  const startFresh = (row: CrewmateView) => {
    void requestConfirmDialog(
      `Start a fresh conversation for ${row.crewmate.displayName}? Its task, its copy of the code and its memory stay.`,
    )?.then((ok) => {
      if (ok) {
        void commands.send(
          { _tag: "startFresh", handle: row.crewmate.handle },
          CREW_ORIGIN.crewmate(row.crewmate.handle),
        );
      }
    });
  };

  /**
   * *Remove from crew* (PRD §5.6): a clean copy goes with it; a copy with
   * commits that never landed is kept and the removal refused, and only then
   * is *Discard* offered.
   */
  const remove = (row: CrewmateView) => {
    const name = row.crewmate.displayName;
    const handle = row.crewmate.handle;
    void requestConfirmDialog(`Remove ${name} from the crew?`)?.then(async (ok) => {
      if (!ok) return;
      const origin = CREW_ORIGIN.crewmate(handle);
      const removed = await commands.send(
        { _tag: "removeCrewmate", handle, discardUnlanded: false },
        origin,
      );
      if (removed !== null || commands.lastRefusal() !== "unlanded-commits") return;
      const discard = await requestConfirmDialog(
        `${name}'s copy of the code has commits that never landed. Discard them and remove ${name}?`,
        { variant: "destructive" },
      );
      if (discard) {
        void commands.send({ _tag: "removeCrewmate", handle, discardUnlanded: true }, origin);
      }
    });
  };

  const deliver = () => {
    void commands.send({ _tag: "deliverDraft" }, CREW_ORIGIN.deliver).then((result) => {
      if (result?._tag !== "deliverDraft") return;
      const count = snapshot.landedNotDelivered;
      setAsk({
        ask: crewDeliverAsk(snapshot, result.dirtyPaths),
        what: `${count} landed ${count === 1 ? "task has" : "tasks have"} not gone out yet.`,
      });
    });
  };

  const addCrewPorts = (host: string, count: number) => {
    void commands.send({ _tag: "addCrewPorts", host, count }, CREW_ORIGIN.ports).then((result) => {
      if (result?._tag !== "crewPorts") return;
      setPortsHost(null);
      onAskMate(crewPortsAsk(result.host, result.ports));
    });
  };

  const portsError = commands.errorAt(CREW_ORIGIN.ports);

  return (
    <section data-zerops-crew>
      {view === null ? (
        <CrewSectionEmpty onSetUp={() => setSetupOpen(true)} />
      ) : (
        <CrewSection
          environmentId={environmentId}
          errorAt={commands.errorAt}
          mateName={mateName}
          onAddCrewPorts={setPortsHost}
          onAddLead={() => setEditor({ kind: "crewmate", target: { handle: null, lead: true } })}
          onResumeRun={() => setRunDialog("resume")}
          onStartRun={() => setRunDialog("start")}
          onAsk={(draft, what) => setAsk({ ask: draft, what })}
          onDeliver={deliver}
          onEditBrief={() => setEditor({ kind: "brief" })}
          onEditCrewmate={(handle) =>
            setEditor({ kind: "crewmate", target: { handle, lead: false } })
          }
          onShowBoard={onShowBoard}
          onOpenThread={openThread}
          onRemove={remove}
          onStartFresh={startFresh}
          pending={commands.pending}
          send={commands.send}
          snapshot={snapshot}
          tell={tell}
          treeCwd={treeCwd}
          view={view}
        />
      )}
      <CrewSetupSheet
        applied={view !== null}
        commands={editorCommands}
        crewmates={snapshot.crewmates}
        devHosts={devHosts}
        homeVersion={homeVersion}
        mateName={mateName}
        mateTint={mate?.tint}
        onDescribe={(draft) =>
          setAsk({ ask: draft, what: `${mateName} writes the crew's files in the Mate's tree.` })
        }
        onEditBrief={() => setEditor({ kind: "brief" })}
        onEditCrewmate={(handle) =>
          setEditor({ kind: "crewmate", target: { handle, lead: false } })
        }
        onOpenChange={setSetupOpen}
        open={setupOpen}
      />
      <CrewBriefSheet
        commands={editorCommands}
        crewmateCount={snapshot.crewmates.length}
        onOpenChange={closeEditor}
        open={editor?.kind === "brief"}
        version={view?.crew?.briefVersion ?? null}
      />
      <CrewmateEditor
        environmentId={environmentId}
        onClose={() => closeEditor(false)}
        target={editor?.kind === "crewmate" ? editor.target : null}
      />
      <CrewRunDialog
        environmentId={environmentId}
        onOpenChange={(open) => {
          if (!open) setRunDialog(null);
        }}
        open={runDialog !== null}
        resume={runDialog === "resume"}
      />
      <CrewPortsDialog
        error={portsError === null ? null : crewNamingTheMate(portsError, mateName)}
        host={portsHost}
        mateName={mateName}
        onConfirm={addCrewPorts}
        onOpenChange={(open) => {
          if (!open) setPortsHost(null);
        }}
        pending={commands.pending}
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
        tint={mate?.tint}
        what={ask?.what ?? ""}
      />
    </section>
  );
}
