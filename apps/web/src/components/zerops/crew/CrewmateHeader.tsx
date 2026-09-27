/**
 * The head of a crewmate's chat (PRD §4.5): its face wearing its current
 * stint's state, its name and `@handle`, the job's first line, the version it
 * runs on — amber while its next turn brings in a newer one — and its menu:
 * *Edit job*, *New task*, *Start fresh*, *Previous conversations*, *Forget
 * memory* (phase C, only once it remembers anything) and *Remove from crew*.
 *
 * A crew thread is the engine's: nothing here archives, renames or starts a
 * new session in it (`ChatHeader` leaves those out for a crew thread).
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadCrewOrigin, ThreadId } from "@t3tools/contracts";
import { mateMarkStateForThreadStatus } from "@t3tools/shared/threadStatus";
import { useRouter } from "@tanstack/react-router";
import { EllipsisIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { mateFaceFor } from "~/zerops/agentActivity";
import { crewCommands } from "~/zerops/crew/crewCommands";
import { useCrew } from "~/zerops/crew/useCrew";
import { crewFailureSentence, useCrewCommand } from "~/zerops/crew/useCrewCommand";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { Button } from "../../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../../ui/menu";
import { Sheet, SheetPopup } from "../../ui/sheet";
import { stackedThreadToast, toastManager } from "../../ui/toast";
import { Chip, MateFace } from "../primitives";
import { CrewNewTaskBody } from "./CrewBoardPanel";
import { crewDependencyOptions, crewTaskOwners } from "./CrewBoardPanel.logic";
import { crewmateHeaderModel } from "./CrewmateHeader.logic";
import { CrewmateConfirmDialog } from "./CrewmateHeaderDialogs";

type OpenDialog = "new-task" | "remove" | "forget" | null;

export function CrewmateHeader({
  environmentId,
  threadId,
  origin,
  onEditJob,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The thread's crew origin: whose chat this is, before the crew is read. */
  readonly origin: ThreadCrewOrigin;
  /** Opens the crew's Crewmate editor on this crewmate. */
  readonly onEditJob: (handle: string) => void;
}) {
  const { view, current } = useCrew(environmentId);
  // The dialogs show their own refusal inline; Start fresh has no surface of
  // its own, so its refusal is a toast carrying the crew phrase.
  const command = useCrewCommand(environmentId);
  const runCommand = useAtomCommand(crewCommands.command, { reportFailure: false });
  const [startingFresh, setStartingFresh] = useState(false);
  const whoLivesHere = useZeropsMate(environmentId);
  const router = useRouter();
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const model = useMemo(
    () => crewmateHeaderModel(view, origin, threadId),
    [origin, threadId, view],
  );
  const row = view?.crewmates.find(({ crewmate }) => crewmate.handle === origin.crewmate);
  const face = mateFaceFor(
    whoLivesHere.kind === "mate" && whoLivesHere.mate.connected,
    row?.status == null ? undefined : { face: mateMarkStateForThreadStatus(row.status.kind) },
  );

  if (model === null) {
    return (
      <span
        className="min-w-0 truncate font-medium text-foreground"
        data-zerops-surface="header-crewmate"
      >
        @{origin.crewmate}
      </span>
    );
  }
  const { handle } = model;

  const open = (target: ThreadId) =>
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, target)),
    });
  const startFresh = async () => {
    setStartingFresh(true);
    const result = await runCommand({ environmentId, input: { _tag: "startFresh", handle } });
    setStartingFresh(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Couldn't start @${handle} fresh`,
          description: crewFailureSentence(squashAtomCommandFailure(result)),
        }),
      );
    }
  };
  const openDialog = (next: OpenDialog) => {
    command.clearError();
    setDialog(next);
  };
  const closeOnSuccess = async (run: () => Promise<unknown>) => {
    if ((await run()) !== null) setDialog(null);
  };

  return (
    <span className="inline-flex min-w-0 items-center gap-2" data-zerops-surface="header-crewmate">
      <MateFace size="sm" state={face} tint={model.tint} />
      <span className="max-w-40 shrink-0 truncate font-medium text-foreground">{model.name}</span>
      <span className="shrink-0 text-muted-foreground">@{handle}</span>
      {model.login === null ? null : (
        <span className="shrink-0 text-xs text-muted-foreground">{model.login}</span>
      )}
      <span className="min-w-0 truncate text-muted-foreground">{model.job}</span>
      <Chip
        className="shrink-0"
        label={model.version.label}
        tone={model.version.pending ? "attention" : "off"}
      />
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label={`More for @${handle}`}
              className="shrink-0"
              size="icon-xs"
              variant="ghost-muted"
            />
          }
        >
          <EllipsisIcon aria-hidden="true" className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuItem onClick={() => onEditJob(handle)}>Edit job</MenuItem>
          <MenuItem onClick={() => openDialog("new-task")}>New task…</MenuItem>
          <MenuItem disabled={startingFresh} onClick={() => void startFresh()}>
            Start fresh
          </MenuItem>
          {model.previous.length === 0 ? null : (
            <MenuSub>
              <MenuSubTrigger>Previous conversations</MenuSubTrigger>
              <MenuSubPopup>
                {model.previous.map((stint) => (
                  <MenuItem key={stint.threadId} onClick={() => open(stint.threadId)}>
                    {stint.label}
                  </MenuItem>
                ))}
              </MenuSubPopup>
            </MenuSub>
          )}
          {model.memoryEntries === 0 ? null : (
            <MenuItem onClick={() => openDialog("forget")}>Forget memory…</MenuItem>
          )}
          <MenuSeparator />
          <MenuItem onClick={() => openDialog("remove")}>Remove from crew…</MenuItem>
        </MenuPopup>
      </Menu>
      {/* The board's New task sheet, starting with this crewmate as its owner. */}
      <Sheet
        onOpenChange={(next) => setDialog(next ? "new-task" : null)}
        open={dialog === "new-task"}
      >
        <SheetPopup side="right">
          {dialog === "new-task" && view !== null ? (
            <CrewNewTaskBody
              canAct={current && !command.pending}
              dependencies={crewDependencyOptions(view)}
              error={command.error}
              onCreate={(task) => void closeOnSuccess(() => command.send(task))}
              owner={handle}
              owners={crewTaskOwners(view)}
            />
          ) : null}
        </SheetPopup>
      </Sheet>
      <CrewmateConfirmDialog
        confirm={model.unlandedCommits > 0 ? "Remove and discard" : "Remove"}
        description={
          model.unlandedCommits > 0
            ? `Its copy of the code has ${model.unlandedCommits} ${model.unlandedCommits === 1 ? "commit" : "commits"} that never landed; removing @${handle} discards them. Its conversations stay readable.`
            : `Its copy of the code has nothing that has not landed. Its conversations stay readable.`
        }
        error={command.error}
        onConfirm={() =>
          void closeOnSuccess(() =>
            command.send({
              _tag: "removeCrewmate",
              handle,
              discardUnlanded: model.unlandedCommits > 0,
            }),
          )
        }
        onOpenChange={(next) => setDialog(next ? "remove" : null)}
        open={dialog === "remove"}
        sending={command.isPending("removeCrewmate")}
        title={`Remove @${handle} from the crew?`}
      />
      <CrewmateConfirmDialog
        confirm="Forget"
        description={`Clears ${model.memoryEntries} ${model.memoryEntries === 1 ? "thing" : "things"} @${handle} remembers. Its copy of the code and its tasks stay.`}
        error={command.error}
        onConfirm={() => void closeOnSuccess(() => command.send({ _tag: "forgetMemory", handle }))}
        onOpenChange={(next) => setDialog(next ? "forget" : null)}
        open={dialog === "forget"}
        sending={command.isPending("forgetMemory")}
        title={`Forget what @${handle} remembers?`}
      />
    </span>
  );
}
