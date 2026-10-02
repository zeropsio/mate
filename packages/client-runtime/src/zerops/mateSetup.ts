/**
 * A Mate's setup as its own server tells it: `GET /mate/setup.json`, public, beside
 * `/mate/healthz` (the setup contract, pass 28). The press does every step that needs the person's
 * rights; the container does the rest — zcp imports the tier's runtimes on boot and enrolls the
 * Mate with its HQ, which is its Git access, the server starts the stand-up — and this is how any
 * browser, or none, sees where that stands.
 *
 * ```json
 * { "version": 1, "at": "RFC3339", "steps": [
 *   { "id": "container", "state": "done", "at": "" },
 *   { "id": "git",       "state": "waiting|done", "at": "" },
 *   { "id": "runtimes",  "state": "none|waiting|running|done|failed|unknown", "at": "" },
 *   { "id": "signin",    "state": "waiting|done", "at": "" },
 *   { "id": "standup",   "state": "waiting|running|done|failed", "at": "" } ] }
 * ```
 *
 * It carries no names, no error text and no secrets. A `404` is an older Mate, whose server has
 * no such route — and so is an answer that is not this document: an older server's catch-all
 * answers any path with its page, or with no CORS header at all, which a browser reports as no
 * answer. Its caller falls back to `/mate/healthz` on anything but a `setup` reading. A step or a
 * state this build does not know is ignored, never guessed at — a field is only ever added with
 * a `version` bump.
 *
 * Read as `containerHealth.ts` reads: a plain header-less GET with `redirect: "manual"`, which
 * forces no CORS preflight.
 *
 * @module mateSetup
 */
import { zeropsMateBaseUrl } from "./candidates.ts";
import type { FetchLike } from "./containerHealth.ts";

export type MateSetupStepId = "container" | "git" | "runtimes" | "signin" | "standup";

export type MateSetupRuntimesState = "none" | "waiting" | "running" | "done" | "failed" | "unknown";

export interface MateSetup {
  readonly at: string;
  readonly container?: "done";
  readonly git?: "waiting" | "done";
  readonly runtimes?: MateSetupRuntimesState;
  readonly signin?: "waiting" | "done";
  readonly standup?: "waiting" | "running" | "done" | "failed";
}

const STATES: { readonly [Id in MateSetupStepId]: ReadonlySet<string> } = {
  container: new Set(["done"]),
  git: new Set(["waiting", "done"]),
  runtimes: new Set(["none", "waiting", "running", "done", "failed", "unknown"]),
  signin: new Set(["waiting", "done"]),
  standup: new Set(["waiting", "running", "done", "failed"]),
};

const isStepId = (id: unknown): id is MateSetupStepId =>
  typeof id === "string" && Object.hasOwn(STATES, id);

/** The document, or `undefined` for one this build cannot read as version 1. */
export function parseMateSetup(body: unknown): MateSetup | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { version, at, steps } = body as { version?: unknown; at?: unknown; steps?: unknown };
  // A later version only adds: the steps this build knows read the same.
  if (typeof version !== "number" || version < 1 || !Array.isArray(steps)) return undefined;
  const read: Record<string, string> = {};
  for (const step of steps) {
    if (typeof step !== "object" || step === null) continue;
    const { id, state } = step as { id?: unknown; state?: unknown };
    if (!isStepId(id) || typeof state !== "string" || !STATES[id].has(state)) continue;
    read[id] = state;
  }
  return { at: typeof at === "string" ? at : "", ...read } as MateSetup;
}

export type MateSetupReading =
  | { readonly kind: "setup"; readonly setup: MateSetup }
  /** An older Mate: no such route. The caller reads `/mate/healthz`. */
  | { readonly kind: "absent" }
  /** No answer it can read: down, still starting, or refused. */
  | { readonly kind: "unreachable" };

export async function readMateSetup(
  origin: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal,
): Promise<MateSetupReading> {
  const url = `${zeropsMateBaseUrl(origin.replace(/\/+$/, ""))}/setup.json`;
  let response: Response;
  try {
    response = await fetchImpl(
      url,
      signal === undefined ? { redirect: "manual" } : { redirect: "manual", signal },
    );
  } catch {
    return { kind: "unreachable" };
  }
  // A redirect is the cookie gate: not a route this container serves.
  if (response.status === 404 || response.type === "opaqueredirect") return { kind: "absent" };
  if (!response.ok) return { kind: "unreachable" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "absent" };
  }
  const setup = parseMateSetup(body);
  return setup === undefined ? { kind: "absent" } : { kind: "setup", setup };
}
