/**
 * An Owner's or Admin's sign-in to an organisation HQ has not started or whose key HQ refuses (spec-mate §3.7, K3's
 * line "the organisation's key is minted once per organisation"): the client mints a key only
 * after HQ answered `org_not_started` or `org_key_refused`, under a lock named for the organisation, and asks HQ again
 * inside the lock, so a second tab finds the organisation started. A key HQ did not keep
 * (`orgKeyKept: false`) or refused is deleted again.
 */

export interface OrgStartPorts<A extends { readonly orgKeyKept?: boolean }> {
  readonly orgId: string;
  /** Runs `run` while no other holder of `name` runs, across this browser's tabs. */
  readonly withLock: <T>(name: string, run: () => Promise<T>) => Promise<T>;
  /** Whether this person may start the organisation: an active Owner or Admin. */
  readonly mayStart: () => Promise<boolean>;
  /** The sign-in request, with the organisation's key when one is handed over. */
  readonly signIn: (orgKey?: string) => Promise<A>;
  readonly needsOrgKey: (cause: unknown) => boolean;
  readonly mintKey: () => Promise<{ readonly id: string; readonly token: string }>;
  readonly deleteKey: (id: string) => Promise<void>;
}

export const orgKeyLockName = (orgId: string): string => `mate.org-key.${orgId}`;

export async function signInStartingOrganisation<A extends { readonly orgKeyKept?: boolean }>(
  ports: OrgStartPorts<A>,
): Promise<A> {
  try {
    return await ports.signIn();
  } catch (cause) {
    if (!ports.needsOrgKey(cause) || !(await ports.mayStart())) throw cause;
    return ports.withLock(orgKeyLockName(ports.orgId), async () => {
      try {
        return await ports.signIn();
      } catch (again) {
        if (!ports.needsOrgKey(again)) throw again;
      }
      const key = await ports.mintKey();
      let answer: A;
      try {
        answer = await ports.signIn(key.token);
      } catch (refused) {
        await ports.deleteKey(key.id).catch(() => undefined);
        throw refused;
      }
      if (answer.orgKeyKept === false) await ports.deleteKey(key.id).catch(() => undefined);
      return answer;
    });
  }
}
