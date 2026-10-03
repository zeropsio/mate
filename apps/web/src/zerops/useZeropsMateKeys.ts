/**
 * Keeps every Mate's key lowered: `BASIC_USER` on its own project and nothing
 * added beside it (`groupReach.ts`, guide 0.2, ADR 0003).
 *
 * The decision is `planAccountMateKeys`; this is the shell that reads the
 * account and performs the writes. A key this client mints holds its own
 * project from the start; this is how a Mate this client never created — the
 * pool's from sign-up, an older account's, one made in the Zerops GUI — has the
 * `ADMIN` the platform minted its key with lowered at all. It writes no grant on
 * another project. One a key already holds stays as it is: a separate step
 * removes those.
 *
 * Running on every read is deliberate and cheap. A token write changes grants,
 * never a container's environment, so nothing restarts, and an account whose
 * keys are lowered plans no write at all.
 *
 * Failures are swallowed on purpose. This is a background repair of something
 * the user did not ask for; a token the account is not allowed to rewrite, or
 * a network that dropped, must not put an error on a screen that is otherwise
 * fine. The next read tries again.
 *
 * This reconcile never restarts a Mate (spec-mate §3 B-1/B-2/B-3): a birth
 * has exactly one restart and it runs before anyone is admitted, in the
 * press's close-off (`matePress.ts`). A reconcile running from a page a
 * person is already in must not carry that restart along with it —
 * `isolateProjectEnv` used to run here too and would throw someone already
 * inside a conversation out of it mid-session.
 *
 * The delegation drop (guide 0.4) lives in the birth too
 * (`ZeropsApiClient.hardenMate`, run by the press): the one-time mint is
 * dropped once, at birth, never re-read here.
 *
 * The re-run key covers the token set, not only the Mates: a token that
 * appears after a Mate finishes hardening changes nothing about which projects
 * are Mates, so a key built from the Mates alone never changed and the
 * reconcile never re-ran for it (measured live 2026-09-22, a hardened Mate's
 * token still carrying a delegation because its `lastKey` had not moved).
 */

import {
  selectTokenGrants,
  type TokensCellRequest,
  type ZeropsIntegrationTokenGrantMetadata,
} from "@t3tools/client-runtime/zerops/data";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  planAccountMateKeys,
  writeTokenProjectsFresh,
  type ZeropsIntegrationToken,
} from "@t3tools/client-runtime/zerops";
import { tokenWrites } from "./tokenWriteLock";
import { runZeropsCommand, useKnown, useZeropsData } from "./zeropsDataContext";

/** Serialises the Mates so an unchanged account is not re-read. */
function matesKey(mateProjectIds: ReadonlyArray<string>): string {
  return [...new Set(mateProjectIds)].sort().join(",");
}

/**
 * Serialises the token set the plan reads from: which tokens exist and what
 * they currently grant. A token that appears, disappears, or has its grants
 * changed by anything other than this reconcile (a hardened birth, a manual
 * edit) is a reason to re-plan even when the Mates themselves did not change.
 */
function tokensKey(tokens: ReadonlyArray<ZeropsIntegrationToken>): string {
  return [...tokens]
    .map(
      (token) =>
        `${token.id}:${(token.projects ?? [])
          .map((grant) => `${grant.projectId}=${grant.roleCode}`)
          .sort()
          .join(",")}`,
    )
    .sort()
    .join(";");
}

/** Restores the existing planner shape from credential-free grant metadata. */
export function integrationTokensFromGrantMetadata(
  metadata: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata>,
): ReadonlyArray<ZeropsIntegrationToken> {
  return metadata.map((token) => ({
    id: token.tokenId,
    name: token.name,
    projects: token.grants,
    ...(token.roleCode === undefined ? {} : { roleCode: token.roleCode }),
    ...(token.created === undefined ? {} : { created: token.created }),
    ...(token.createdByUser === undefined ? {} : { createdByUser: token.createdByUser }),
  }));
}

/** How long a write the platform refused waits before it is planned again. */
export const MATE_KEYS_BACKOFF_MS: ReadonlyArray<number> = [30_000, 120_000, 600_000];

export function useZeropsMateKeys(input: {
  readonly clientId: string | undefined;
  /** Every project that holds a Mate: the projects whose keys this lowers. */
  readonly mateProjectIds: ReadonlyArray<string>;
  readonly enabled: boolean;
}): void {
  const { clientId, mateProjectIds, enabled } = input;
  const { organizationRef, runtime } = useZeropsData();
  const lastKey = useRef<string | null>(null);
  /** A write the platform refused: when it may be planned again, and how often it was. */
  const refused = useRef<{
    readonly key: string;
    readonly attempts: number;
    readonly retryAtMs: number;
  } | null>(null);
  const [wake, setWake] = useState(0);
  const wakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (wakeTimer.current !== null) clearTimeout(wakeTimer.current);
    },
    [],
  );
  const key = matesKey(mateProjectIds);
  const hasMate = mateProjectIds.length > 0;
  const request = useMemo<TokensCellRequest | null>(
    () =>
      enabled && clientId !== undefined && hasMate
        ? {
            kind: "tokens",
            account: runtime.scope,
            organization: organizationRef(clientId),
          }
        : null,
    [clientId, enabled, hasMate, organizationRef, runtime.scope],
  );
  const grants = selectTokenGrants(
    useKnown(request === null ? null : runtime.cells.known(request)),
  );
  const grantMetadata = grants.status === "known" ? grants.grants : null;

  const tokens = useMemo(
    () => (grantMetadata === null ? null : integrationTokensFromGrantMetadata(grantMetadata)),
    [grantMetadata],
  );
  const tokenSetKey = tokens === null ? null : tokensKey(tokens);

  useEffect(() => {
    // An account with no Mate has no token of ours to touch.
    if (!enabled || clientId === undefined || !hasMate) return;
    if (grants.status === "failed") {
      lastKey.current = null;
      return;
    }
    if (tokens === null || tokenSetKey === null) return;
    // A write the platform refused waits out its back-off, however often the list is read again.
    const planKey = `${clientId}:${key}`;
    if (refused.current?.key === planKey && performance.now() < refused.current.retryAtMs) return;
    const runKey = `${clientId}:${key}:${tokenSetKey}`;
    if (lastKey.current === runKey) return;
    lastKey.current = runKey;
    // The shared list says whether anything is owed; where nothing is, nothing more is read — the
    // organization's token list is one heavy response, and every projects page loads it.
    if (planAccountMateKeys({ mateProjectIds, tokens }).length === 0) return;

    let cancelled = false;
    let finished = false;
    void (async () => {
      try {
        // The shared list says which keys are owed; each write replaces a token's whole project
        // list, so it is planned from that token read by its id right before it.
        const organization = organizationRef(clientId);
        await writeTokenProjectsFresh({
          tokens,
          readOne: async (tokenId) => {
            const read = await runZeropsCommand(
              runtime.commands.readIntegrationTokenGrant({ organization, tokenId }),
            );
            return read === null ? undefined : integrationTokensFromGrantMetadata([read])[0];
          },
          plan: (fresh) =>
            cancelled ? [] : planAccountMateKeys({ mateProjectIds, tokens: fresh }),
          write: (write) =>
            runZeropsCommand(
              runtime.commands.setIntegrationTokenProjects({ organization, ...write }),
            ).then(() => undefined),
          hold: tokenWrites,
        });
        finished = true;
        if (refused.current?.key === planKey) refused.current = null;
      } catch {
        finished = true;
        // Background repair: never an error the person did not ask for, and never a loop on a
        // write the platform keeps refusing — it is planned again after 30 s, 2 min, then 10 min.
        const attempts = (refused.current?.key === planKey ? refused.current.attempts : 0) + 1;
        const waitMs = MATE_KEYS_BACKOFF_MS[Math.min(attempts, MATE_KEYS_BACKOFF_MS.length) - 1]!;
        refused.current = { key: planKey, attempts, retryAtMs: performance.now() + waitMs };
        lastKey.current = null;
        if (wakeTimer.current !== null) clearTimeout(wakeTimer.current);
        wakeTimer.current = setTimeout(() => {
          wakeTimer.current = null;
          setWake((count) => count + 1);
        }, waitMs);
      }
    })();

    return () => {
      cancelled = true;
      // Cut short — the list was read again, or the page went — what it had left is still owed:
      // the next run plans it again, whatever key the list shows.
      if (!finished) lastKey.current = null;
    };
  }, [
    clientId,
    enabled,
    tokens,
    tokenSetKey,
    grants.status,
    mateProjectIds,
    hasMate,
    key,
    organizationRef,
    runtime.commands,
    wake,
  ]);
}
