/**
 * Whether the viewer only reads a Mate's conversation (D6): its agent is a
 * personal login another project member signed in. The conversation shows no
 * composer, no answers and no approvals then (`resolveZeropsConversationReadOnly`),
 * and every surface that acts for the viewer outside it — the jump box —
 * reads the same rule the same way, so none offers what the conversation
 * would not.
 *
 * What is not read yet is not read-only: the conversation keeps its composer
 * while its agent's sign-in is unread, and so does every surface here.
 */
import { useAtomValue } from "@effect/atom-react";
import { resolveAgentOwnership } from "@t3tools/client-runtime/zerops";
import { zeropsAgentAuthView } from "@t3tools/client-runtime/zerops/agentLogin";
import {
  agentIdForProviderInstance,
  type EnvironmentId,
  type ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import type { OverviewLogins } from "@t3tools/shared/mateLink";
import { useMemo } from "react";

import { resolveZeropsConversationReadOnly } from "../components/ChatView.logic";
import { hqMatesAtom } from "../state/zerops";
import { resolveAgentAuthorizer } from "@t3tools/client-runtime/zerops/agentOwnership";
import { useZeropsAgentAuth } from "./useZeropsFeeds";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

/** The rule itself, over what was read: the agent's snapshot, and who is looking. */
export function mateReadOnly(input: {
  readonly snapshot: ZeropsAgentAuthSnapshot | null;
  /** The provider instance the conversation runs on (its model selection's). */
  readonly instanceId: string | undefined;
  readonly viewerSubject: string | undefined;
}): boolean {
  const agentId = agentIdForProviderInstance(input.instanceId);
  const agent = input.snapshot?.agents.find((entry) => entry.agentId === agentId);
  return (
    resolveZeropsConversationReadOnly({
      agent,
      ownership: resolveAgentOwnership({
        credPresent: agent?.credPresent ?? false,
        authorizedBy:
          agent === undefined ? undefined : resolveAgentAuthorizer(agent, input.viewerSubject),
        viewerSubject: input.viewerSubject,
      }),
    }) !== null
  );
}

export function useMateReadOnly(
  environmentId: EnvironmentId | null,
  /** The provider instance the conversation runs on (its model selection's). */
  instanceId: string | undefined,
): boolean {
  const { snapshot } = zeropsAgentAuthView(useZeropsAgentAuth(environmentId));
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  return mateReadOnly({ snapshot, instanceId, viewerSubject });
}

/**
 * The rule over the logins HQ holds of a Mate (`@t3tools/shared/mateLink`): the agent's own login,
 * whose signer it records. What HQ does not hold, and a conversation whose agent is not known, is
 * not read yet.
 */
export function mateLoginsReadOnly(input: {
  readonly logins: OverviewLogins | undefined;
  /** The provider instance the conversation runs on (its model selection's). */
  readonly instanceId: string | undefined;
  readonly viewerSubject: string | undefined;
}): boolean {
  const agentId = agentIdForProviderInstance(input.instanceId);
  const login = agentId === undefined ? undefined : input.logins?.[agentId];
  return (
    resolveZeropsConversationReadOnly({
      agent: login === undefined ? undefined : { flagToken: login.token },
      ownership: resolveAgentOwnership({
        credPresent: login?.present ?? false,
        authorizedBy: login?.signedInBy == null ? undefined : { subject: login.signedInBy },
        viewerSubject: input.viewerSubject,
      }),
    }) !== null
  );
}

/** One Mate's conversation, for {@link useMatesReadOnly}. */
export interface MateConversationRef {
  readonly projectId: string;
  readonly instanceId: string | undefined;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The Mates of `mates` the viewer may not write to, by project id, from the logins HQ holds of
 * each — the jump box asks as it opens, so a Mate that is somebody else's is left out before `@`
 * is typed, and no Mate is woken to answer.
 */
export function useMatesReadOnly(mates: ReadonlyArray<MateConversationRef>): ReadonlySet<string> {
  const held = useAtomValue(hqMatesAtom)?.mates ?? null;
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  return useMemo(() => {
    const theirs = mates.flatMap((mate) =>
      mateLoginsReadOnly({
        logins: held?.get(mate.projectId)?.logins,
        instanceId: mate.instanceId,
        viewerSubject,
      })
        ? [mate.projectId]
        : [],
    );
    return theirs.length === 0 ? NONE : new Set(theirs);
  }, [held, mates, viewerSubject]);
}
