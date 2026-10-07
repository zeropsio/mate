/**
 * The jump box in the app (`JumpBox.tsx`): the menu's index, the server's
 * search of the conversations, and what finding and writing do.
 *
 * Finding goes to the thing found. A Mate, or words in its conversation, open
 * that conversation, as its row does (`useOpenMate`). A project, a stop or a
 * change is shown where it is in the menu — its project opened, its row
 * focused and flashed — or, on the
 * settings pages, whose menu is their own, that thing's own page.
 *
 * Writing sends without opening anything, with what a send from the Mate's
 * own composer carries: the conversation's own model and modes, and what the
 * Mate has not been told of the changes that landed since it last spoke
 * (`agentTurnNotes`). A run already on reads it at its next step: the server
 * steers a message sent during a run into it — the composer's queue, which
 * holds a message for the next tool step so it can still be edited, is the
 * composer's, and there is no composer here. A question the Mate asks takes
 * the words as its answer (`thread.user-input.respond`), as the composer
 * does; several questions at once, or one that takes only its own answers,
 * open the conversation instead. A Mate nobody has asked anything yet opens
 * with the words sent from there (`requestSend`), since a first message is
 * the conversation's to send. A Mate another member signed in is theirs
 * (D6): it is not offered at all.
 */
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { agentLastSpokeAt, agentNotesFor, agentTurnNotes } from "@t3tools/client-runtime/zerops";
import { ApprovalRequestId, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { useEffect, useMemo, useRef, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useClientSettings } from "~/hooks/useSettings";
import { newMessageId } from "~/lib/utils";
import { useThreadShells } from "~/state/entities";
import { useThreadSearch } from "~/state/queries";
import { threadEnvironment, useEnvironmentThread } from "~/state/threads";
import { formatShortTimestamp } from "~/timestampFormat";
import { useMateCommand, useMateHeld } from "~/zerops/accountEnvironments";
import { askNewProject } from "~/zerops/newProjectAsk";
import { useSidebarJump } from "~/zerops/sidebarJump";
import { useMateReadOnly, useMatesReadOnly } from "~/zerops/useMateReadOnly";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useMatesActivity } from "~/zerops/useZeropsAgentActivity";
import { useZeropsChangeLandedEvents } from "~/zerops/useZeropsChangeLandedEvents";
import { useVaultTurnNotes } from "~/zerops/vaultTurnNotes";

import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  chooseJumpItem,
  JumpBoxView,
  jumpSearchText,
  useJumpBoxModel,
  useJumpBoxState,
  type JumpPages,
  type JumpWriteLine,
} from "./JumpBox";
import {
  jumpWritePlan,
  withLiveMates,
  type JumpHit,
  type JumpMate,
  type JumpWriteAction,
  type SidebarJumpIndex,
} from "./JumpBox.logic";
import { mateDecision } from "./mateDecision.logic";

/** Enter's word in the keys row, for what Enter does now. */
const ENTER_WORD: Record<JumpWriteAction, string | undefined> = {
  send: "Send without opening",
  answer: "Answer",
  "open-and-send": "Open and send",
  open: "Open",
  wait: "Send without opening",
  none: undefined,
};

export function SidebarJumpBox({
  index: drawn,
  setOpen,
  onCommands,
}: {
  readonly index: SidebarJumpIndex;
  readonly setOpen: (open: boolean) => void;
  readonly onCommands: (value: string) => void;
}) {
  const state = useJumpBoxState();
  // What each Mate is doing now, as its row reads it, over what the menu
  // last drew: a phone's menu is put away while the box is open.
  const activity = useMatesActivity();
  const index = useMemo(
    () =>
      withLiveMates(
        drawn,
        (mate) =>
          activity.ofProject(mate.projectId) ??
          (mate.connected && mate.environmentId !== undefined
            ? activity.ofEnvironment(EnvironmentId.make(mate.environmentId))
            : undefined),
      ),
    [activity, drawn],
  );
  // Whose Mates the viewer may not write to (D6), read as the box opens.
  const shells = useThreadShells();
  const conversations = useMemo(
    () =>
      index.mates.flatMap((mate) => {
        const conversation = mate.conversation;
        if (mate.environmentId === undefined || conversation === undefined) return [];
        const shell = shells.find(
          (entry) =>
            entry.environmentId === mate.environmentId && entry.id === conversation.threadId,
        );
        return [
          {
            projectId: mate.projectId,
            environmentId: mate.environmentId,
            instanceId: shell?.modelSelection.instanceId,
          },
        ];
      }),
    [index.mates, shells],
  );
  const readOnly = useMatesReadOnly(conversations);
  // The conversations of the Mates the menu shows, searched by the server.
  const environmentIds = useMemo(
    () => conversations.map((entry) => EnvironmentId.make(entry.environmentId)),
    [conversations],
  );
  const search = useThreadSearch(environmentIds, jumpSearchText(state));
  const hits = useMemo(
    (): ReadonlyArray<JumpHit> =>
      search.matches.map((match) => ({
        environmentId: match.environmentId,
        threadId: match.threadId,
        source: match.source,
        snippet: match.snippet,
      })),
    [search.matches],
  );
  const model = useJumpBoxModel(state, index, hits, readOnly);
  const showable = useSidebarJump((store) => store.showable);
  const pages = useJumpPages();
  const close = () => {
    setOpen(false);
  };
  const write = useJumpWrite(model.target, close, pages.openMate);

  return (
    <JumpBoxView
      model={model}
      onChoose={(item) => {
        chooseJumpItem(item, { model, showable, close, pages });
      }}
      onCommands={onCommands}
      onSend={write.send}
      searching={search.isPending}
      write={write.line}
    />
  );
}

/**
 * Where a find goes on its own: a Mate's conversation — or its own view while that cannot be
 * opened, the listing not holding it yet included (`useOpenMate`) — and every other thing's page.
 */
function useJumpPages(): JumpPages {
  const router = useRouter();
  const openMateOf = useOpenMate();
  return useMemo(
    () => ({
      openMate: (mate) => {
        openMateOf({ projectId: mate.projectId });
      },
      openProject: (groupId) => {
        void router.navigate({ to: "/group/$groupId/flow", params: { groupId } });
      },
      openStop: (stop) => {
        void router.navigate({
          to: "/group/$groupId/$projectId",
          params: { groupId: stop.groupId, projectId: stop.projectId },
        });
      },
      openChange: (change) => {
        void router.navigate({
          to: "/change/$groupId/$repository/$number",
          params: {
            groupId: change.groupId,
            repository: change.repository,
            number: String(change.number),
          },
        });
      },
      // Its dialog, over whatever is on screen (`ZeropsNewProjectHost`).
      newProject: askNewProject,
    }),
    [openMateOf, router],
  );
}

/**
 * Writing to the picked Mate: what the line under the field says, and the
 * send Enter makes. Its conversation is read while it is picked — what it
 * asks, and what it last said — and a send made before that read waits for
 * it, so no send goes without what the Mate's own composer would carry. The
 * Mate is held connected while it is picked (`useMateHeld`): a parked one
 * connects for the read and the send, and parks again once the box lets it go.
 */
function useJumpWrite(
  target: JumpMate | undefined,
  close: () => void,
  openMate: (mate: JumpMate) => void,
): { readonly line: JumpWriteLine | undefined; readonly send: (text: string) => void } {
  const environmentId =
    target?.environmentId === undefined ? null : EnvironmentId.make(target.environmentId);
  const threadId =
    target?.conversation === undefined ? null : ThreadId.make(target.conversation.threadId);
  const shells = useThreadShells();
  const shell = shells.find(
    (entry) => entry.environmentId === environmentId && entry.id === threadId,
  );
  useMateHeld(environmentId);
  const thread = useEnvironmentThread(environmentId, threadId);
  const detail = Option.getOrUndefined(thread.data);
  const requests = useMemo(
    () => derivePendingRequests(detail?.activities ?? []),
    [detail?.activities],
  );
  const readOnly = useMateReadOnly(environmentId, shell?.modelSelection.instanceId);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const landed = useZeropsChangeLandedEvents(environmentId);
  // The vault changes the Mate has not heard, the same note its own composer would carry.
  const vaultTurn = useVaultTurnNotes(
    environmentId,
    environmentId === null || threadId === null
      ? null
      : scopedThreadKey(scopeThreadRef(environmentId, threadId)),
    useMemo(() => (detail === undefined ? undefined : agentLastSpokeAt(detail.messages)), [detail]),
  );
  // A parked Mate's cached conversation reads before its link is up: the send waits for it.
  const startTurn = useMateCommand(threadEnvironment.startTurn, { reportFailure: false });
  const respondToUserInput = useMateCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  // Words sent while the conversation was still being read: they go once it is.
  const queued = useRef<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const decision =
    target?.conversation === undefined
      ? undefined
      : mateDecision({
          name: target.name,
          kind: target.conversation.kind,
          read: detail !== undefined,
          approvals: requests.approvals,
          userInputs: requests.userInputs,
          failure: detail?.session?.lastError ?? undefined,
          failureDriver: detail?.session?.providerName ?? null,
        });
  const plan =
    target?.conversation === undefined
      ? undefined
      : jumpWritePlan({
          name: target.name,
          owner: target.owner,
          conversation: target.conversation,
          pausedUntilLabel:
            target.pausedUntil === undefined
              ? undefined
              : formatShortTimestamp(target.pausedUntil, timestampFormat),
          started: shell === undefined ? undefined : shell.latestUserMessageAt !== null,
          readOnly,
          decision,
        });
  // Every send carries what the Mate's composer would: nothing goes before
  // its conversation is read.
  const action: JumpWriteAction | undefined =
    plan === undefined
      ? undefined
      : detail === undefined && (plan.action === "send" || plan.action === "answer")
        ? "wait"
        : plan.action;

  const failed = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
    const failure = squashAtomCommandFailure(result);
    setError(
      failure instanceof Error && failure.message.trim().length > 0
        ? `Not sent: ${failure.message}`
        : "Not sent. Try again.",
    );
  };
  const sent = (mate: JumpMate) => {
    close();
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: `Sent to ${mate.name}`,
        timeout: 5_000,
        actionProps: {
          children: "Open",
          onClick: () => {
            openMate(mate);
          },
        },
        data: { hideCopyButton: true },
      }),
    );
  };

  const deliver = (text: string) => {
    if (
      target === undefined ||
      environmentId === null ||
      threadId === null ||
      detail === undefined ||
      plan === undefined ||
      shell === undefined
    ) {
      setSending(false);
      return;
    }
    setSending(true);
    setError(undefined);
    if (plan.action === "answer" && decision?.kind === "question") {
      void respondToUserInput({
        environmentId,
        input: {
          threadId,
          requestId: ApprovalRequestId.make(decision.requestId),
          answers: { [decision.questionId]: text },
        },
      }).then((result) => {
        setSending(false);
        if (result._tag === "Success") sent(target);
        else if (!isAtomCommandInterrupted(result)) failed(result);
      });
      return;
    }
    // When the agent last spoke: the line between what it knows and what
    // landed since — the conversation's own reading of it. A slash command
    // carries none.
    const notes = agentNotesFor(text, [
      ...agentTurnNotes(landed, agentLastSpokeAt(detail.messages)),
      ...(vaultTurn.note === null ? [] : [vaultTurn.note]),
    ]);
    const toldVault =
      vaultTurn.note !== null && notes.includes(vaultTurn.note) ? vaultTurn.changes : [];
    void startTurn({
      environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        modelSelection: shell.modelSelection,
        ...(notes.length > 0 ? { agentNotes: notes } : {}),
        runtimeMode: shell.runtimeMode,
        interactionMode: shell.interactionMode,
        createdAt: new Date().toISOString(),
      },
    }).then((result) => {
      setSending(false);
      if (result._tag === "Success") {
        vaultTurn.told(toldVault);
        sent(target);
      } else if (!isAtomCommandInterrupted(result)) failed(result);
    });
  };

  /** What Enter does with the words, as the plan reads now. */
  const act = (text: string) => {
    if (target === undefined || plan === undefined || plan.action === "none") {
      setSending(false);
      return;
    }
    if (plan.action === "open") {
      close();
      openMate(target);
      return;
    }
    if (plan.action === "open-and-send") {
      if (environmentId !== null && threadId !== null) {
        useComposerDraftStore.getState().requestSend(scopeThreadRef(environmentId, threadId), text);
      }
      close();
      openMate(target);
      return;
    }
    // What it waits on, and what it last said, are not read yet: the send
    // goes once they are, as whatever they make it.
    if (detail === undefined) {
      queued.current = text;
      setSending(true);
      return;
    }
    if (plan.action === "wait") {
      setSending(false);
      setError("Not sent: what it waits on could not be read. Open its conversation.");
      return;
    }
    deliver(text);
  };

  const send = (raw: string) => {
    const text = raw.trim();
    if (text.length === 0 || sending) return;
    act(text);
  };

  // A send made while the conversation was still being read goes once it is.
  useEffect(() => {
    const text = queued.current;
    if (text === null || detail === undefined) return;
    queued.current = null;
    act(text);
  });

  return {
    line:
      plan === undefined || action === undefined
        ? undefined
        : {
            hint: plan.hint,
            enter: ENTER_WORD[action],
            error,
            sending,
          },
    send,
  };
}
