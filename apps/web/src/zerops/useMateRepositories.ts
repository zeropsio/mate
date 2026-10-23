/**
 * A Mate's checkouts that are Git repositories on disk now, in the Git tab's order: the runtime
 * services its topology lists (`gitCheckoutHostnames`), or a bound thread's lease alone
 * (`threadCheckoutHostnames`), each read as the Git tab reads it (the server's status of
 * `/var/www/{hostname}`). Empty off Zerops, after a failed read, or not asked (`environmentId`
 * null: a hidden terminal reads nothing).
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  gitCheckoutHostnames,
  threadCheckoutHostnames,
  type CheckoutLease,
} from "@t3tools/client-runtime/zerops";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useMemo, useState } from "react";

import { vcsStatus } from "../state/workspace";
import { repositoriesOnDisk } from "./terminalCwd.logic";
import { useProjectTopology } from "./useProjectTopology";

const NONE: ReadonlyArray<string> = [];
const NONE_ATOM = Atom.make<ReadonlyArray<string> | null>(NONE);
const UNREAD_ATOM = Atom.make<ReadonlyArray<string> | null>(null);
/** How long a terminal waits for the checkouts before it opens in the workspace. */
const UNREAD_WAIT_MS = 3000;

/** The checkouts; `null` while the topology or a checkout's status is still read, however long. */
export function useMateCheckouts(
  environmentId: EnvironmentId | null,
  /** The thread's lease; `null` for none. */
  lease: CheckoutLease | null,
): ReadonlyArray<string> | null {
  const { view, error } = useProjectTopology(environmentId);
  const key =
    threadCheckoutHostnames(
      view === undefined ? undefined : gitCheckoutHostnames(view.services),
      lease,
    )?.join("\n") ?? null;
  const atom = useMemo(() => {
    if (environmentId === null || key === "") return NONE_ATOM;
    if (key === null) return error === undefined ? UNREAD_ATOM : NONE_ATOM;
    const hostnames = key.split("\n");
    return Atom.make((get) =>
      repositoriesOnDisk(hostnames, (cwd) => {
        const status = get(vcsStatus({ environmentId, input: { cwd } }));
        if (AsyncResult.isInitial(status)) return null;
        return Option.getOrNull(AsyncResult.value(status))?.isRepo === true;
      }),
    );
  }, [environmentId, error, key]);
  return useAtomValue(atom);
}

/**
 * The checkouts as a terminal waits for them: `null` while still read for at most
 * `UNREAD_WAIT_MS`, so it never opens outside the code, and never waits longer.
 */
export function useMateRepositories(
  environmentId: EnvironmentId | null,
  lease: CheckoutLease | null,
): ReadonlyArray<string> | null {
  const repositories = useMateCheckouts(environmentId, lease);
  const unread = repositories === null;
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (!unread) return;
    const timer = setTimeout(() => setWaited(true), UNREAD_WAIT_MS);
    return () => clearTimeout(timer);
  }, [unread]);
  return repositories ?? (waited ? NONE : null);
}
