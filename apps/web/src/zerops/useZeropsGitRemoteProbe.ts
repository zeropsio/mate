/**
 * Whether each checkout's remote actually answers — asked, never assumed.
 *
 * `zerops.git.probeRemote` runs `git ls-remote` in the service that owns the
 * repository, which is the one party that can say (guide 4.5): a remote being
 * configured is true of a Mate whose credential was never written, and the last
 * push having worked says only that it worked then.
 *
 * **On open and after each action, never on a timer.** The answer changes when
 * somebody does something — a credential written and the container restarted, a
 * push, a pull — and a probe on a clock would spend a process in the container
 * every minute to re-learn a fact nothing has touched. `generation` is what the
 * tab bumps after a verb, and it is the only thing that asks again.
 *
 * A probe that could not be *run* (no git, no checkout, a timeout) says nothing
 * at all: the repository keeps whatever it last answered, and an unanswered one
 * stays `undefined`, which is never read as fine.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { zeropsCommands } from "../state/zeropsCommands";
import { useAtomCommand } from "../state/use-atom-command";

/** Where zcp mounts every sibling service on the container. */
export const ZEROPS_WORKSPACE_ROOT = "/var/www";

/** One runtime service's checkout path. */
export function checkoutPathFor(hostname: string): string {
  return `${ZEROPS_WORKSPACE_ROOT}/${hostname}`;
}

/** What the probe answered for one repository. */
export interface ZeropsGitRemoteAnswer {
  readonly reachable: boolean;
  /** Git's own line when it refused; `undefined` when it answered. */
  readonly detail: string | undefined;
}

const EMPTY: ReadonlyMap<string, ZeropsGitRemoteAnswer> = new Map();

export function useZeropsGitRemoteProbes(input: {
  readonly environmentId: EnvironmentId | undefined;
  /** The repositories of this Mate, by hostname. */
  readonly repositories: ReadonlyArray<string>;
  /** Bumped by the tab after each verb — the one thing that asks again. */
  readonly generation: number;
}): ReadonlyMap<string, ZeropsGitRemoteAnswer> {
  const { environmentId, generation, repositories } = input;
  const [answer, setAnswer] = useState<{
    readonly scope: string;
    readonly answers: ReadonlyMap<string, ZeropsGitRemoteAnswer>;
  } | null>(null);
  const probe = useAtomCommand(zeropsCommands.gitProbeRemote, {
    label: "zerops git probe remote",
    reportFailure: false,
  });
  // Another Mate's answers are not this one's, and its repositories are not
  // either; a round after a verb keeps what it already answered, so the block
  // does not lose its line and gain it back.
  const scope = `${environmentId ?? ""}|${repositories.join(",")}`;

  useEffect(() => {
    if (environmentId === undefined || repositories.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const repository of repositories) {
        const result = await probe({
          environmentId,
          input: { cwd: checkoutPathFor(repository) },
        });
        if (cancelled) return;
        // A refusal is an answer (`reachable: false`); a probe that could not
        // run is not, and leaves the repository saying nothing.
        if (result._tag !== "Success") continue;
        const found: ZeropsGitRemoteAnswer = {
          reachable: result.value.reachable,
          detail: result.value.detail ?? undefined,
        };
        setAnswer((current) => ({
          scope,
          answers: new Map(current?.scope === scope ? current.answers : []).set(repository, found),
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // `generation` is the tab's verb counter: it is what asks again, and the
    // repositories are what is asked about.
  }, [environmentId, generation, probe, repositories, scope]);

  return answer?.scope === scope ? answer.answers : EMPTY;
}
