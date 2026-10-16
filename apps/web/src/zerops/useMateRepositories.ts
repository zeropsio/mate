/**
 * A Mate's checkouts that are Git repositories on disk now, in the Git tab's order: the runtime
 * services its topology lists (`gitCheckoutHostnames`), each read as the Git tab reads it (the
 * server's status of `/var/www/{hostname}`). Empty while unread, off Zerops, or not asked
 * (`environmentId` null: a hidden terminal reads nothing).
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { gitCheckoutHostnames } from "@t3tools/client-runtime/zerops";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useMemo } from "react";

import { vcsStatus } from "../state/workspace";
import { repositoriesOnDisk } from "./terminalCwd.logic";
import { useProjectTopology } from "./useProjectTopology";

const NONE: ReadonlyArray<string> = [];
const NONE_ATOM = Atom.make(NONE);

export function useMateRepositories(environmentId: EnvironmentId | null): ReadonlyArray<string> {
  const { view } = useProjectTopology(environmentId);
  const key = view === undefined ? "" : gitCheckoutHostnames(view.services).join("\n");
  const atom = useMemo(() => {
    if (environmentId === null || key === "") return NONE_ATOM;
    const hostnames = key.split("\n");
    return Atom.make((get) =>
      repositoriesOnDisk(
        hostnames,
        (cwd) =>
          Option.getOrNull(AsyncResult.value(get(vcsStatus({ environmentId, input: { cwd } }))))
            ?.isRepo === true,
      ),
    );
  }, [environmentId, key]);
  return useAtomValue(atom);
}
