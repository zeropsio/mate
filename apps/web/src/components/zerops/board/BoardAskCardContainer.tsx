/**
 * A board ask as the conversation draws it: the work the Mate proposed for its application's
 * Board, its title and brief editable while it waits, with **Put on board** — the person's own
 * write to HQ (`useBoardTaskWrites`), after which the engine hears the task's id — and Not now.
 * Done, it reads "On the board". The card's state is the engine's record and this card's put
 * (`appTaskPut`); a minimal face the Board's interface replaces.
 */
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { BOARD_BRIEF_MAX, BOARD_TITLE_MAX } from "@t3tools/shared/hqIntake";
import { useMemo, useState } from "react";

import { useThreadDetail } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useMateOfEnvironment } from "~/zerops/accountEnvironments";
import { useAppTaskPut, useBoardTaskWrites } from "~/zerops/useTaskSourceSettings";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { useApplicationOfProject } from "~/components/zerops/useGitEnvironmentFormInputs";
import { AskCard, AskFooter } from "../../ask/AskCard";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Textarea } from "../../ui/textarea";
import { boardAskFromKey, boardAskKey, boardAskState } from "./boardAsk.logic";

export function BoardAskCardContainer({
  requestId,
  environmentId,
  threadRef,
}: {
  readonly requestId: string;
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
}) {
  // As a string, so a change elsewhere in the thread draws nothing here.
  const key = useThreadDetail(
    threadRef,
    useMemo(
      () => (detail: { readonly activities?: unknown } | null) =>
        boardAskKey(detail?.activities as Parameters<typeof boardAskKey>[0], requestId),
      [requestId],
    ),
  );
  const ask = useMemo(() => boardAskFromKey(key), [key]);
  if (ask === null || environmentId === null || threadRef === null) return null;
  return <BoardAsk ask={ask} environmentId={environmentId} threadRef={threadRef} />;
}

function BoardAsk({
  ask,
  environmentId,
  threadRef,
}: {
  readonly ask: NonNullable<ReturnType<typeof boardAskFromKey>>;
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
}) {
  const { requestId } = ask;
  const mate = useKnownMate(environmentId);
  const mateName = mate?.name ?? "Your Mate";
  const location = useMateOfEnvironment(environmentId);
  const mateProjectId = location?.projectId ?? mate?.projectId;
  const appId = useApplicationOfProject(mateProjectId)?.id ?? null;
  const writes = useBoardTaskWrites(appId);
  const put = useAppTaskPut(appId, requestId);
  const answerBoardAsk = useAtomCommand(threadEnvironment.answerBoardAsk, {
    reportFailure: false,
  });
  const [title, setTitle] = useState(ask.title);
  const [brief, setBrief] = useState(ask.brief);
  const [refusal, setRefusal] = useState<string | null>(null);
  // The task this card put, until the engine took it: a Try again tells the engine, never puts again.
  const [putTaskId, setPutTaskId] = useState<string | null>(null);

  const tell = async (said: { outcome: "put"; taskId: string } | { outcome: "declined" }) => {
    setRefusal(null);
    const result = await answerBoardAsk({
      environmentId,
      input: { threadId: threadRef.threadId, requestId, ...said },
    });
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    setRefusal(error instanceof Error ? error.message : "The Mate did not take the answer.");
  };
  const putOnBoard = async () => {
    if (putTaskId !== null) return tell({ outcome: "put", taskId: putTaskId });
    if (writes === null || mateProjectId === undefined) return;
    const task = await writes.put(requestId, {
      title: title.trim(),
      brief: brief.trim(),
      from: { mateProjectId, conversationId: threadRef.threadId },
    });
    if (task === null) return;
    setPutTaskId(task.id);
    await tell({ outcome: "put", taskId: task.id });
  };

  const state = boardAskState({ state: ask.state, put, refusal, by: null, at: null });
  const editable = putTaskId === null && (state.kind === "waiting" || state.kind === "failed");
  const ready =
    writes !== null && mateProjectId !== undefined && title.trim() !== "" && brief.trim() !== "";
  return (
    <div data-board-request={requestId} data-board-request-face={state.kind}>
      <AskCard
        askId={requestId}
        density="full"
        footer={
          <AskFooter
            action={
              state.kind === "failed" ? (
                <Button onClick={() => void putOnBoard()} size="md" variant="secondary">
                  Try again
                </Button>
              ) : undefined
            }
            density="full"
            main={{
              label: "Put on board",
              onPress: () => void putOnBoard(),
              disabled: !ready,
            }}
            onNotNow={() => void tell({ outcome: "declined" })}
            state={state}
          />
        }
        kind="board"
        state={state.kind}
        title={title.trim() === "" ? ask.title : title}
        where={{ scope: "project", detail: null }}
        why={{ who: mateName, words: "Proposed for the Board, for whoever takes it." }}
      >
        {editable ? (
          <div className="grid gap-2">
            <Input
              aria-label="Title"
              maxLength={BOARD_TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
            <Textarea
              aria-label="Brief"
              maxLength={BOARD_BRIEF_MAX}
              onChange={(event) => setBrief(event.target.value)}
              value={brief}
            />
          </div>
        ) : null}
      </AskCard>
    </div>
  );
}
