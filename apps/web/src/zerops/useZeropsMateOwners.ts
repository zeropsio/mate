/**
 * Whose each Mate is, by name — read only when a row needs to say so.
 *
 * A Mate a person cannot open says "Jan's Mate — only Jan opens it" (D5), and
 * a name is the one part of that the project record does not carry: its
 * `userRoles` name a `clientUser` id, and only the org's member list turns
 * that into a person.
 *
 * So the list is read once per account, and only when at least one row would
 * use it. A person who can open everything they can see never makes the call
 * at all. What comes back is metadata — names, e-mails, roles — and never a
 * credential; any token of the org may read it (measured 2026-09-15).
 *
 * A read that fails leaves every name undefined, and the rows then say the
 * same thing without one. Nothing here is worth an error on the screen.
 */

import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import { useEffect, useRef, useState } from "react";

import { useZeropsSession } from "./ZeropsSessionProvider";

export function useZeropsOrganizationMembers(input: {
  readonly clientId: string | undefined;
  /** Nothing is read until a row would use a name. */
  readonly enabled: boolean;
}): ReadonlyArray<ZeropsOrganizationMember> {
  const { client } = useZeropsSession();
  const [members, setMembers] = useState<ReadonlyArray<ZeropsOrganizationMember>>([]);
  const read = useRef<string | null>(null);
  const { clientId, enabled } = input;

  useEffect(() => {
    if (!enabled || clientId === undefined) return;
    if (read.current === clientId) return;
    read.current = clientId;

    const controller = new AbortController();
    void client
      .listOrganizationMembers(clientId, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setMembers(answer);
      })
      .catch(() => {
        // No names, and the rows say the same thing without them.
        read.current = null;
      });

    return () => {
      controller.abort();
    };
  }, [client, clientId, enabled]);

  return members;
}
