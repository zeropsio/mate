/**
 * A Mate's peek in the app: the tree's row facts, and the thread's own
 * activities read while the peek is open.
 *
 * The shell paints the peek at once — what was asked, the last words, the
 * plan's count and the step it is on — and the thread's detail, subscribed
 * for as long as the peek stands, fills in every step's words and what the
 * Mate waits on. The plan's list keeps its height while that happens
 * (`matePeekSteps`).
 *
 * What it waits on is answered here with the conversation's own commands: a
 * question's option or words (`thread.user-input.respond`), an approval's
 * choice (`thread.approval.respond`). Neither starts a turn, so the server
 * lets any member send them — but the conversation renders neither on a Mate
 * another member signed in (D6, `resolveZeropsConversationReadOnly`), and the
 * peek follows it: it shows the question, and who it waits for. *Stop*
 * (`thread.turn.interrupt`) is open to every member, as the server means it
 * to be: a colleague must be able to stop an agent they may not start.
 */
import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { resolveAgentOwnership } from "@t3tools/client-runtime/zerops";
import { zeropsAgentAuthView } from "@t3tools/client-runtime/zerops/agentLogin";
import {
  agentIdForProviderInstance,
  ApprovalRequestId,
  ProviderApprovalDecision,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { useMemo, useState } from "react";

import { deriveActivePlanState } from "~/session-logic";
import { threadEnvironment, useEnvironmentThread } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { resolveAgentAuthorizer, useLocalAgentSigners } from "~/zerops/useZeropsAgentSigner";
import type { ZeropsCandidatePresentation } from "~/zerops/useZeropsCandidates";
import { useZeropsAgentAuth } from "~/zerops/useZeropsFeeds";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";

import { resolveZeropsConversationReadOnly } from "../ChatView.logic";
import { toastManager } from "../ui/toast";
import { MatePeekCard, useMatePeekKeys } from "./SidebarMatePeek";
import {
  askedLabelFor,
  matePeekDecision,
  matePeekSteps,
  type MatePeekChoice,
} from "./SidebarMatePeek.logic";
import type { SidebarPeekRender } from "./SidebarZeropsTree";

const isApprovalDecision = Schema.is(ProviderApprovalDecision);

/** A peek whose Mate waits on no choice offers none. */
const NO_CHOICES: ReadonlyArray<MatePeekChoice> = [];

export function SidebarMatePeekLive({
  peek,
}: {
  readonly peek: SidebarPeekRender<ZeropsCandidatePresentation>;
}) {
  const { activity } = peek;
  const environmentId = peek.candidate.environmentId ?? null;
  const threadId = activity?.threadId ?? null;
  const thread = useEnvironmentThread(environmentId, threadId);
  const detail = Option.getOrUndefined(thread.data);
  const activities = detail?.activities;
  const plan = useMemo(
    () =>
      detail === undefined
        ? null
        : deriveActivePlanState(detail.activities, detail.latestTurn?.turnId ?? undefined),
    [detail],
  );
  const requests = useMemo(() => derivePendingRequests(activities ?? []), [activities]);
  const working = activity?.kind === "working" || activity?.kind === "connecting";
  const paused = activity?.pausedUntil !== undefined;
  const steps =
    working || paused
      ? matePeekSteps({
          plan,
          progress:
            activity?.progress === undefined || activity.subject === undefined
              ? undefined
              : {
                  step: activity.subject,
                  completedSteps: activity.progress.completed,
                  totalSteps: activity.progress.total,
                },
        })
      : undefined;
  const decision =
    activity === undefined
      ? undefined
      : matePeekDecision({
          name: peek.name,
          kind: activity.kind,
          read: detail !== undefined,
          approvals: requests.approvals,
          userInputs: requests.userInputs,
          failure: detail?.session?.lastError ?? undefined,
        });

  // Who may answer it: the conversation's own rule (D6), read the same way.
  const agentAuth = zeropsAgentAuthView(useZeropsAgentAuth(environmentId));
  const localSigners = useLocalAgentSigners();
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  const agentId = agentIdForProviderInstance(detail?.modelSelection.instanceId);
  const agent = agentAuth.snapshot?.agents.find((entry) => entry.agentId === agentId);
  const readOnly =
    resolveZeropsConversationReadOnly({
      agent,
      ownership: resolveAgentOwnership({
        credPresent: agent?.credPresent ?? false,
        authorizedBy:
          agent === undefined
            ? undefined
            : resolveAgentAuthorizer(agent.agentId, agent.authorizedBy, localSigners),
        viewerSubject,
      }),
    }) !== null;
  const waitingOn = !readOnly
    ? undefined
    : peek.owner !== undefined && !peek.owner.isViewer
      ? (peek.owner.name.trim().split(/\s+/u)[0] ?? peek.owner.name)
      : "the person who signed it in";

  const respondToApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const respondToUserInput = useAtomCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const interrupt = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const [responding, setResponding] = useState(false);

  const failed = (title: string, result: Parameters<typeof squashAtomCommandFailure>[0]) => {
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title,
      ...(error instanceof Error ? { description: error.message } : {}),
    });
  };

  const answer = (values: Record<string, string>) => {
    if (environmentId === null || threadId === null || decision?.kind !== "question") return;
    setResponding(true);
    void respondToUserInput({
      environmentId,
      input: { threadId, requestId: ApprovalRequestId.make(decision.requestId), answers: values },
    }).then((result) => {
      setResponding(false);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        failed(`Could not answer ${peek.name}`, result);
      }
    });
  };
  const choose = (choice: MatePeekChoice) => {
    if (responding || readOnly || environmentId === null || threadId === null) return;
    if (decision?.kind === "question") {
      answer({ [decision.questionId]: choice.value });
      return;
    }
    if (decision?.kind === "approval" && isApprovalDecision(choice.value)) {
      setResponding(true);
      void respondToApproval({
        environmentId,
        input: {
          threadId,
          requestId: ApprovalRequestId.make(decision.requestId),
          decision: choice.value,
        },
      }).then((result) => {
        setResponding(false);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          failed(`Could not answer ${peek.name}`, result);
        }
      });
    }
  };
  const stop =
    environmentId === null || threadId === null || peek.face !== "working"
      ? undefined
      : () => {
          void interrupt({ environmentId, input: { threadId } }).then((result) => {
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              failed(`Could not stop ${peek.name}`, result);
            }
          });
        };

  // While the peek stands, its keys (`matePeekKey`).
  useMatePeekKeys({
    choices:
      decision?.kind === "question" || decision?.kind === "approval"
        ? decision.choices
        : NO_CHOICES,
    answerable: !readOnly && !responding,
    onChoose: choose,
    onStop: stop,
    onClose: peek.onClose,
  });

  return (
    <MatePeekCard
      appUrl={peek.appUrl}
      askedLabel={askedLabelFor(peek.owner)}
      change={peek.change}
      decision={decision}
      face={peek.face}
      lastWords={activity?.snippet}
      name={peek.name}
      onChoose={choose}
      onMore={peek.onMore}
      onOpen={peek.onOpen}
      onStop={stop}
      onText={(text) => {
        if (decision?.kind === "question" && !readOnly) answer({ [decision.questionId]: text });
      }}
      projectName={peek.projectName}
      responding={responding}
      steps={steps}
      stepsLabel={paused ? "Plan, paused at a usage limit" : "Plan"}
      task={activity?.task}
      time={peek.time}
      tint={peek.tint}
      waitingOn={waitingOn}
    />
  );
}
