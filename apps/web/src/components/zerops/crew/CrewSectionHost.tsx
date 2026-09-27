/**
 * The Crew section's host in the Zerops tab (PRD §4.3, seam S6): reads the
 * crew, owns its commands, its editors and its drafts for Fen, and renders
 * nothing unless the crew feed says there is a crew surface — status `none`
 * (set one up) or `applied`. Status `off`, a Mate without the feed, or a feed
 * not read yet leaves the tab exactly as it was.
 *
 * Three command states, so each outcome shows where it was pressed: the
 * section's presses, *Tell the crew*, and the editors.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { CrewmateView, CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { CrewSnapshot, EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { requestConfirmDialog } from "../../../confirmDialog";
import { buildThreadRouteParams } from "../../../threadRoutes";
import { hasCrewSurface, useCrew } from "../../../zerops/crew/useCrew";
import { useCrewCommand } from "../../../zerops/crew/useCrewCommand";
import { useAskMate } from "../../../zerops/useAskMate";
import { useEnvironmentProjectRef, useEnvironmentTopology } from "../../../zerops/useZeropsFeeds";
import { ZeropsAskDialog } from "../ZeropsAskDialog";
import { CrewBriefSheet } from "./CrewBriefSheet";
import { crewDevHosts } from "./CrewEditors.logic";
import { crewDeliverAsk, crewPortsAsk } from "./CrewSection.logic";
import { CrewSection, CrewSectionEmpty } from "./CrewSection";
import { CrewmateEditor } from "./CrewmateEditor";
import type { CrewmateSheetTarget } from "./CrewmateSheet";
import { CrewPortsDialog } from "./CrewPortsDialog";
import { CrewSetupSheet } from "./CrewSetupSheet";

type Editor =
  | { readonly kind: "brief" }
  | { readonly kind: "crewmate"; readonly target: CrewmateSheetTarget }
  | null;

interface HostProps {
  /** The Mate who lives here: Fen, in its tint. */
  readonly mate: { readonly name: string; readonly tint: MateTintId } | undefined;
  /** Opens the board (right-panel kind `crew`); `null` while there is none to open. */
  readonly onOpenBoard: (() => void) | null;
}

export function CrewSectionHost({
  threadRef,
  ...props
}: HostProps & { readonly threadRef: ScopedThreadRef | null }) {
  const environmentId = threadRef?.environmentId ?? null;
  const crew = useCrew(environmentId);
  if (environmentId === null || !hasCrewSurface(crew.status) || crew.snapshot === null) {
    return null;
  }
  return (
    <CrewSectionFor
      {...props}
      environmentId={environmentId}
      snapshot={crew.snapshot}
      view={crew.status === "applied" ? crew.view : null}
    />
  );
}

function CrewSectionFor({
  environmentId,
  snapshot,
  view,
  mate,
  onOpenBoard,
}: HostProps & {
  readonly environmentId: EnvironmentId;
  readonly snapshot: CrewSnapshot;
  /** `null` while no crew is applied. */
  readonly view: CrewView<EnvironmentThreadShell> | null;
}) {
  const commands = useCrewCommand(environmentId);
  const tell = useCrewCommand(environmentId);
  const editorCommands = useCrewCommand(environmentId);
  const navigate = useNavigate();
  const askMate = useAskMate();
  const projectId = useEnvironmentProjectRef(environmentId)?.projectId;
  const services = useEnvironmentTopology(environmentId).view?.services;
  const [setupOpen, setSetupOpen] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [homeVersion, setHomeVersion] = useState(0);
  const [portsHost, setPortsHost] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ readonly ask: string; readonly what: string } | null>(null);
  const mateName = mate?.name ?? "the Mate";
  const devHosts = crewDevHosts(
    services,
    snapshot.hosts.map((host) => host.host),
  );

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
      if (ok) void commands.send({ _tag: "startFresh", handle: row.crewmate.handle });
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
      const removed = await commands.send({
        _tag: "removeCrewmate",
        handle,
        discardUnlanded: false,
      });
      if (removed !== null || commands.lastRefusal() !== "unlanded-commits") return;
      const discard = await requestConfirmDialog(
        `${name}'s copy of the code has commits that never landed. Discard them and remove ${name}?`,
        { variant: "destructive" },
      );
      if (discard) void commands.send({ _tag: "removeCrewmate", handle, discardUnlanded: true });
    });
  };

  const deliver = () => {
    void commands.send({ _tag: "deliverDraft" }).then((result) => {
      if (result?._tag !== "deliverDraft") return;
      const count = snapshot.landedNotDelivered;
      setAsk({
        ask: crewDeliverAsk(snapshot, result.dirtyPaths),
        what: `${count} landed ${count === 1 ? "task has" : "tasks have"} not gone out yet.`,
      });
    });
  };

  const addCrewPorts = (host: string, count: number) => {
    void commands.send({ _tag: "addCrewPorts", host, count }).then((result) => {
      if (result?._tag !== "crewPorts") return;
      setPortsHost(null);
      askMate(projectId, crewPortsAsk(result.host, result.ports));
    });
  };

  return (
    <section data-zerops-crew>
      {view === null ? (
        <CrewSectionEmpty onSetUp={() => setSetupOpen(true)} />
      ) : (
        <CrewSection
          error={commands.error}
          onAddCrewPorts={setPortsHost}
          onAddLead={() => setEditor({ kind: "crewmate", target: { handle: null, lead: true } })}
          onAsk={(draft, what) => setAsk({ ask: draft, what })}
          onDeliver={deliver}
          onEditBrief={() => setEditor({ kind: "brief" })}
          onEditCrewmate={(handle) =>
            setEditor({ kind: "crewmate", target: { handle, lead: false } })
          }
          onOpenBoard={onOpenBoard}
          onOpenThread={openThread}
          onRemove={remove}
          onStartFresh={startFresh}
          pending={commands.pending}
          send={commands.send}
          snapshot={snapshot}
          tell={tell}
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
      <CrewPortsDialog
        error={commands.error}
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
          askMate(projectId, ask.ask);
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
