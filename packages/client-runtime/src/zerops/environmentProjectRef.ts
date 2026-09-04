// @effect-diagnostics globalDate:off -- `now` is an injected clock with a plain `Date.now()` default,
// the same shape `activity/observe.ts` uses; every real caller may still override it.
/**
 * Which Zerops project and organization a connected environment belongs to —
 * durable, injected-storage-backed memory the client needs now that it reads
 * the platform directly (`topology.ts`, `platformWatch.ts`) instead of a mate
 * server that already knew its own project by being inside the container.
 *
 * `remember`/`lookup`/`forget` mirror `session.ts`'s free-function-over-an-
 * injected-`ZeropsStorageAdapter` style, so web can back this with the same
 * `localStorage` adapter it already uses for the session and mobile with its
 * secure storage, without either owning the encoding.
 *
 * Three sources, in the order a caller should prefer trusting them:
 * - `"connect"` — read straight off the candidate the user connected through
 *   (`useZeropsIdentityExchange.ts`'s caller); exact.
 * - `"descriptor"` — the environment's own `/.well-known/t3/environment`
 *   document naming its Zerops project (S4 follow-up); exact.
 * - `"match"` — a one-time origin match against the account's candidates
 *   (`candidates.ts`'s `deriveZeropsCandidates`), the fallback for an
 *   environment connected before this existed. Run at most once per
 *   environment; the caller that runs it is responsible for `remember`-ing
 *   the result (a miss is not remembered, so a later sign-in with access to
 *   the project can still resolve it).
 */
import type { EnvironmentId } from "@t3tools/contracts";

import type { ZeropsStorageAdapter } from "./session.ts";

export type EnvironmentProjectRefSource = "connect" | "match" | "descriptor";

export interface EnvironmentProjectRef {
  readonly projectId: string;
  readonly orgId: string;
  /** Epoch ms this client learned it. */
  readonly learnedAt: number;
  readonly source: EnvironmentProjectRefSource;
}

export const ZEROPS_ENVIRONMENT_PROJECT_REF_STORAGE_KEY =
  "zerops-mate.zerops-environment-project-ref.v1";

function isEnvironmentProjectRef(value: unknown): value is EnvironmentProjectRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Partial<EnvironmentProjectRef>;
  return (
    typeof ref.projectId === "string" &&
    ref.projectId.length > 0 &&
    typeof ref.orgId === "string" &&
    ref.orgId.length > 0 &&
    typeof ref.learnedAt === "number" &&
    (ref.source === "connect" || ref.source === "match" || ref.source === "descriptor")
  );
}

async function readStore(
  storage: ZeropsStorageAdapter,
): Promise<Record<string, EnvironmentProjectRef>> {
  const raw = await storage.get(ZEROPS_ENVIRONMENT_PROJECT_REF_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const store: Record<string, EnvironmentProjectRef> = {};
    for (const [environmentId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isEnvironmentProjectRef(value)) store[environmentId] = value;
    }
    return store;
  } catch {
    return {};
  }
}

/** The remembered project/org for this environment, or `undefined` when nothing is known yet. */
export async function lookupEnvironmentProjectRef(
  storage: ZeropsStorageAdapter,
  environmentId: EnvironmentId,
): Promise<EnvironmentProjectRef | undefined> {
  const store = await readStore(storage);
  return store[String(environmentId)];
}

/** Records (or overwrites) what this environment resolves to, timestamped now. */
export async function rememberEnvironmentProjectRef(
  storage: ZeropsStorageAdapter,
  environmentId: EnvironmentId,
  ref: {
    readonly projectId: string;
    readonly orgId: string;
    readonly source: EnvironmentProjectRefSource;
  },
  now: () => number = () => Date.now(),
): Promise<void> {
  const store = await readStore(storage);
  store[String(environmentId)] = { ...ref, learnedAt: now() };
  await storage.set(ZEROPS_ENVIRONMENT_PROJECT_REF_STORAGE_KEY, JSON.stringify(store));
}

/** Drops one environment's ref — e.g. it turned out to be wrong. */
export async function forgetEnvironmentProjectRef(
  storage: ZeropsStorageAdapter,
  environmentId: EnvironmentId,
): Promise<void> {
  const store = await readStore(storage);
  if (!(String(environmentId) in store)) return;
  delete store[String(environmentId)];
  await storage.set(ZEROPS_ENVIRONMENT_PROJECT_REF_STORAGE_KEY, JSON.stringify(store));
}

/** Drops every remembered ref — sign-out: the next account may not own the same environments. */
export async function forgetAllEnvironmentProjectRefs(
  storage: ZeropsStorageAdapter,
): Promise<void> {
  await storage.remove(ZEROPS_ENVIRONMENT_PROJECT_REF_STORAGE_KEY);
}
