/**
 * The lane bar (PRD §4.5, seam S7): where `ZeropsLifecycleStrip` stands in a
 * person's chat, a writer's chat shows its copy of the code against your tree
 * and the presses on it — the words and which press applies are
 * `CrewLaneBar.logic.ts`'s; this only draws them and sends the command. What
 * only the Mate can do — declare crew ports, commit your edit — is asked of it
 * in your chat after a confirmation, as the crew section asks it.
 */
import { CREW_LANE_VERBS, crewPortsAsk } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { useCrew } from "~/zerops/crew/useCrew";
import { useCrewCommand } from "~/zerops/crew/useCrewCommand";
import { useAskMate } from "~/zerops/useAskMate";
import { useEnvironmentProjectRef, useZeropsTopology } from "~/zerops/useZeropsFeeds";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { Button } from "../../ui/button";
import { StatusDot } from "../primitives";
import { ZeropsAskDialog } from "../ZeropsAskDialog";
import { crewLaneBarModel } from "./CrewLaneBar.logic";
import { CrewPortsDialog } from "./CrewPortsDialog";

const NOTE_TONE = {
  muted: "text-muted-foreground",
  attention: "text-warning-foreground",
  failed: "text-destructive-foreground",
} as const;

export function CrewLaneBar({
  threadRef,
  handle,
  onOpenChanges,
}: {
  /** The crewmate's chat on screen. */
  readonly threadRef: ScopedThreadRef;
  readonly handle: string;
  /**
   * *Changes*: the chat's diff panel on this chat's thread — whose worktree is
   * the copy — as a branch diff against `baseRef` (the panel's own base while `null`).
   */
  readonly onOpenChanges: (baseRef: string | null) => void;
}) {
  const { snapshot, view, current } = useCrew(threadRef.environmentId);
  const command = useCrewCommand(threadRef.environmentId);
  const askMate = useAskMate();
  const projectId = useEnvironmentProjectRef(threadRef.environmentId)?.projectId;
  const services = useZeropsTopology(threadRef.environmentId)?.services;
  const whoLivesHere = useZeropsMate(threadRef.environmentId);
  const mate = whoLivesHere.kind === "mate" ? whoLivesHere.mate : undefined;
  const [portsHost, setPortsHost] = useState<string | null>(null);
  const [askingCommit, setAskingCommit] = useState(false);
  const row = view?.crewmates.find(({ crewmate }) => crewmate.handle === handle);
  const model = useMemo(
    () =>
      snapshot === null || row === undefined ? null : crewLaneBarModel(snapshot, row, services),
    [row, services, snapshot],
  );
  if (model === null) return null;

  // A press acts on what is shown: nothing is pressed on a stale snapshot.
  const busy = command.pending || !current;
  // Every draft for Fen goes where the section's go: into this chat when it is
  // a person chat, else the main one — from a crewmate's chat, the main one.
  const askFen = (draft: string) => askMate(projectId, draft, { threadId: threadRef.threadId });
  const addCrewPorts = (host: string, count: number) => {
    void command.send({ _tag: "addCrewPorts", host, count }).then((result) => {
      if (result?._tag !== "crewPorts") return;
      setPortsHost(null);
      askFen(crewPortsAsk(result.host, result.ports));
    });
  };
  const commitEdit = model.commitEdit;

  return (
    <div
      className="flex w-full shrink-0 flex-col items-center px-5 sm:px-6"
      data-crew-lane-bar={handle}
    >
      <div className="flex min-h-8 w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 py-1 text-xs">
        <code className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-foreground">
          {model.branch}
        </code>
        {model.ahead === null ? null : <span className="text-muted-foreground">{model.ahead}</span>}
        {model.diffStat === null ? null : (
          <span className="font-mono text-muted-foreground tabular-nums">{model.diffStat}</span>
        )}
        {model.check === null ? null : (
          <StatusDot
            label={model.check.word}
            pulse={model.check.pulse}
            sentence
            tone={model.check.tone}
          />
        )}
        {model.note === null ? null : (
          <span className={cn("min-w-0 truncate", NOTE_TONE[model.note.tone])}>
            {model.note.text}
          </span>
        )}
        {model.ahead === null ? null : (
          <Button onClick={() => onOpenChanges(model.changesBase)} size="xs" variant="ghost-muted">
            Changes
          </Button>
        )}
        {commitEdit === null ? null : (
          <Button onClick={() => setAskingCommit(true)} size="xs" variant="outline">
            {commitEdit.label}
          </Button>
        )}
        {model.ask === null ? null : (
          <Button
            disabled={busy}
            onClick={() =>
              void command.send(
                model.ask!.kind === "askResolve"
                  ? { _tag: "askResolve", taskId: model.ask!.taskId }
                  : { _tag: "askFix", taskId: model.ask!.taskId },
              )
            }
            size="xs"
            variant="outline"
          >
            {model.ask.label}
          </Button>
        )}
        <span className="ms-auto flex shrink-0 items-center gap-2">
          {model.app === null ? null : (
            <span className="flex items-center gap-1 text-muted-foreground">
              {model.app.label}
              {model.app.kind === "running" ? (
                <>
                  {model.app.url === null ? null : (
                    <Button
                      render={<a href={model.app.url} rel="noreferrer" target="_blank" />}
                      size="xs"
                      variant="ghost-muted"
                    >
                      Open
                      <ExternalLinkIcon aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    disabled={busy}
                    onClick={() => void command.send({ _tag: "appStop", handle })}
                    size="xs"
                    variant="ghost-muted"
                  >
                    Stop
                  </Button>
                </>
              ) : model.app.kind === "stopped" ? (
                <Button
                  disabled={busy}
                  onClick={() => void command.send({ _tag: "appRun", handle })}
                  size="xs"
                  variant="ghost-muted"
                >
                  Run
                </Button>
              ) : model.app.kind === "no-crew-ports" ? (
                <Button
                  onClick={() => {
                    command.clearError();
                    if (model.app?.kind === "no-crew-ports") setPortsHost(model.app.host);
                  }}
                  size="xs"
                  variant="ghost-muted"
                >
                  {CREW_LANE_VERBS.addCrewPorts}
                </Button>
              ) : null}
            </span>
          )}
          {model.showOnDev === null ? null : (
            <Button
              disabled={busy || !model.showOnDev.enabled}
              onClick={() =>
                void command.send(
                  model.showOnDev?.kind === "claimRelease"
                    ? { _tag: "claimRelease", host: model.showOnDev.host }
                    : { _tag: "showOnDev", handle },
                )
              }
              size="xs"
              variant="outline"
            >
              {model.showOnDev.label}
            </Button>
          )}
          <Button
            disabled={!model.land.enabled || busy || model.land.taskId === null}
            onClick={() => {
              if (model.land.taskId === null) return;
              void command.send({ _tag: model.land.kind, taskId: model.land.taskId });
            }}
            size="xs"
            variant="pill"
          >
            {model.land.label}
          </Button>
        </span>
      </div>
      {command.error === null || portsHost !== null ? null : (
        <p className="w-full max-w-3xl pb-1 text-xs text-destructive-foreground" role="alert">
          {command.error}
        </p>
      )}
      <CrewPortsDialog
        error={command.error}
        host={portsHost}
        mateName={mate?.name ?? "the Mate"}
        onConfirm={addCrewPorts}
        onOpenChange={(open) => {
          if (!open) setPortsHost(null);
        }}
        pending={command.pending}
      />
      {/* Your tree is yours: the Mate commits your edit, asked as every draft is. */}
      <ZeropsAskDialog
        ask={commitEdit?.ask ?? ""}
        mateName={mate?.name}
        onConfirm={() => {
          setAskingCommit(false);
          if (commitEdit !== null) askFen(commitEdit.ask);
        }}
        onOpenChange={setAskingCommit}
        open={askingCommit && commitEdit !== null}
        sending={false}
        tint={mate?.tint}
        what={commitEdit?.what ?? ""}
      />
    </div>
  );
}
