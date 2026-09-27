/**
 * The lane bar (PRD §4.5, seam S7): where `ZeropsLifecycleStrip` stands in a
 * person's chat, a writer's chat shows its copy of the code against your tree
 * and the presses on it — the words and which press applies are
 * `CrewLaneBar.logic.ts`'s; this only draws them and sends the command.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useMemo } from "react";

import { cn } from "~/lib/utils";
import { useDiffPanelStore } from "~/diffPanelStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { useCrew } from "~/zerops/crew/useCrew";
import { useCrewCommand } from "~/zerops/crew/useCrewCommand";
import { Button } from "../../ui/button";
import { StatusDot } from "../primitives";
import { crewLaneBarModel } from "./CrewLaneBar.logic";

const NOTE_TONE = {
  muted: "text-muted-foreground",
  attention: "text-warning-foreground",
  failed: "text-destructive-foreground",
} as const;

export function CrewLaneBar({
  threadRef,
  handle,
}: {
  /** The crewmate's chat on screen: *Changes* opens its diff there. */
  readonly threadRef: ScopedThreadRef;
  readonly handle: string;
}) {
  const { snapshot, view, current } = useCrew(threadRef.environmentId);
  const command = useCrewCommand(threadRef.environmentId);
  const row = view?.crewmates.find(({ crewmate }) => crewmate.handle === handle);
  const model = useMemo(
    () => (snapshot === null || row === undefined ? null : crewLaneBarModel(snapshot, row)),
    [row, snapshot],
  );
  if (model === null) return null;

  // A press acts on what is shown: nothing is pressed on a stale snapshot.
  const busy = command.pending || !current;
  const openChanges = () => {
    useDiffPanelStore.getState().selectBranchBaseRef(threadRef, null);
    useRightPanelStore.getState().open(threadRef, "diff");
  };

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
          <Button onClick={openChanges} size="xs" variant="ghost-muted">
            Changes
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
                // The dialog lives with the crew, in the Zerops panel.
                <Button
                  onClick={() => useRightPanelStore.getState().open(threadRef, "zerops")}
                  size="xs"
                  variant="ghost-muted"
                >
                  Add crew ports
                </Button>
              ) : null}
            </span>
          )}
          {model.showOnDev === null ? null : (
            <Button
              disabled={busy}
              onClick={() =>
                void command.send({ _tag: model.showOnDev!.kind, host: model.showOnDev!.host })
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
      {command.error === null ? null : (
        <p className="w-full max-w-3xl pb-1 text-xs text-destructive-foreground" role="alert">
          {command.error}
        </p>
      )}
    </div>
  );
}
