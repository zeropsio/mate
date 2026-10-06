/**
 * How one of the organization's scopes is observed now, as a surface says it: complete,
 * live, catching up, or refused and why. The streams' own word, never the presence of data.
 *
 * @module data/projections/freshness
 */
import type { LinkKey, ScopeKey } from "../model.ts";
import type { ProjectionReads } from "../store.ts";
import type { StreamState } from "../streamMachine.ts";

const CATCHING_UP: ReadonlySet<StreamState["phase"]> = new Set(["recovering", "reauthenticating"]);

/** Why a refused scope is unavailable: its session ended, it may not read, or it was refused. */
export type UnavailableReason = "expired-session" | "forbidden" | "refused";

export interface ScopeFreshness {
  /** The scope committed a baseline: what earns an empty answer. */
  readonly complete: boolean;
  readonly live: boolean;
  /** Read before and not live now: what is held stays, catching up. */
  readonly reconnecting: boolean;
  readonly unavailableReason?: UnavailableReason;
}

/** The connection a scope is a child of: `zerops:org` of `zerops:org:projects`. */
const linkOf = (scope: ScopeKey): LinkKey => scope.split(":").slice(0, 2).join(":") as LinkKey;

export function scopeFreshness(read: ProjectionReads, scope: ScopeKey): ScopeFreshness {
  const link = read.stream(linkOf(scope));
  const stream = read.stream(scope);
  const refusal = [link, stream].find((candidate) => candidate.phase === "refused");
  // Catching up is the streams' own word — a link retrying or repairing its session, a scope an
  // attempt already registered left stale — whether or not anything was read before; the first
  // connect is not.
  const catchingUp =
    CATCHING_UP.has(link.phase) || (stream.phase === "stale" && stream.generation > 0);
  return {
    complete: read.coverage(scope) === "complete",
    live: link.phase === "live" && stream.phase === "live",
    reconnecting: refusal === undefined && catchingUp,
    ...(refusal === undefined ? {} : { unavailableReason: refusalReason(refusal) }),
  };
}

function refusalReason(stream: StreamState): UnavailableReason {
  switch (stream.fault?.outcome) {
    case "authoritative-denial":
      return "forbidden";
    case "definitive-refusal":
    case "recoverable-session":
      return "expired-session";
    default:
      return "refused";
  }
}
