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
  EnvironmentId,
  type ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { resolveZeropsConversationReadOnly } from "../components/ChatView.logic";
import { zeropsFeeds } from "../state/zerops";
import { resolveAgentAuthorizer } from "./agentSigner";
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

/** One Mate's conversation, for {@link useMatesReadOnly}. */
export interface MateConversationRef {
  readonly projectId: string;
  readonly environmentId: string;
  readonly instanceId: string | undefined;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The Mates of `mates` the viewer may not write to, by project id. Every
 * one's agent sign-in is read while this is mounted — the jump box asks as
 * it opens, so a Mate that is somebody else's is left out before `@` is typed.
 */
export function useMatesReadOnly(mates: ReadonlyArray<MateConversationRef>): ReadonlySet<string> {
  // Keyed by the environments' names, so the Mates' faces moving on read
  // nothing again.
  const key = [...new Set(mates.map((mate) => mate.environmentId))].toSorted().join(" ");
  const environments = useMemo(() => (key.length === 0 ? [] : key.split(" ")), [key]);
  const reads = useAtomValue(
    useMemo(
      () =>
        Atom.make((get) =>
          environments.map((environmentId) =>
            get(
              zeropsFeeds.agentAuth({
                environmentId: EnvironmentId.make(environmentId),
                input: {},
              }),
            ),
          ),
        ).pipe(Atom.withLabel(`web:mates-read-only:${key}`)),
      [environments, key],
    ),
  );
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  return useMemo(() => {
    const snapshots = new Map(
      environments.map((environmentId, index) => [
        environmentId,
        zeropsAgentAuthView(reads[index]).snapshot,
      ]),
    );
    const theirs = mates.flatMap((mate) =>
      mateReadOnly({
        snapshot: snapshots.get(mate.environmentId) ?? null,
        instanceId: mate.instanceId,
        viewerSubject,
      })
        ? [mate.projectId]
        : [],
    );
    return theirs.length === 0 ? NONE : new Set(theirs);
  }, [environments, mates, reads, viewerSubject]);
}
