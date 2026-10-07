/**
 * The vault, as a surface reads it: a Zerops project's variables — one Shared vault (the project's
 * own variables) and one per service (its own), each plain or sensitive — and, for every value,
 * who reads it: the services whose deployed zerops.yml `run.envVariables` reference it. The
 * contract between the `vault` projection and the surfaces that draw and write it.
 *
 * Measured 2026-10-07 (`verified.md`): a deploy activates references (a service's yaml-baked
 * entries are its active version's `run.envVariables`, templates unresolved); a restart activates
 * values (a running process keeps the environment it booted with); `KEY: ${KEY}` reaches the
 * process as the literal text `${KEY}`, and so does every reference nothing resolves; build
 * entries are exposed nowhere, so who reads a value at build is never known here. Sensitive values
 * are never read: Zerops answers `REDACTED` for them, even to their owner.
 *
 * @module data/projections/vaultModel
 */

/** Which vault: the project's Shared one, or one service's own. */
export type VaultScopeRef =
  | { readonly kind: "shared" }
  | { readonly kind: "service"; readonly serviceId: string };

/** One project's vaults, what reads them, and what is not live yet. */
export interface VaultView {
  /**
   * `unread` until both the project's and its services' variables have answered once; `failed`
   * where either read was refused or could not be read (what an earlier answer said is kept and
   * still shown); `ready` otherwise. Never inferred from missing rows.
   */
  readonly status: "unread" | "ready" | "failed";
  /**
   * Both reads answered whole: every row was read. Until then an absence proves nothing — no
   * `unread` or `missing` is claimed, and an impact never says nothing reads a value.
   */
  readonly complete: boolean;
  /**
   * Shared first, then the project's runtime services by hostname, then the ones Zerops runs for
   * it (databases, storage…) by hostname. The Mate's own container (zcp) and build containers are
   * never listed.
   */
  readonly scopes: ReadonlyArray<VaultScope>;
  /** What is not live yet, each a fact with its fix; empty when everything is live. */
  readonly notLive: ReadonlyArray<VaultNotLive>;
}

export interface VaultScope {
  readonly ref: VaultScopeRef;
  /** `"shared"`, or the service's id. */
  readonly id: string;
  /** The service's hostname; `null` for Shared (the surface names it). */
  readonly hostname: string | null;
  readonly kind: "shared" | "runtime" | "managed";
  /** The service's type and version (`nodejs@22`, `postgresql@17`) for its mark; `null` for Shared. */
  readonly serviceType: string | null;
  /** Whether the person writes values here: Shared and runtime services, never a managed one. */
  readonly editable: boolean;
  /**
   * Its values by key: the person's own (Shared, runtime) or the ones Zerops made (managed, read
   * only). A runtime service's platform-made ones (hostname, PATH…) are not values here.
   */
  readonly values: ReadonlyArray<VaultValue>;
  /** A runtime service's deployed zerops.yml run entries, by key; empty for the others. */
  readonly reads: ReadonlyArray<VaultRead>;
  /**
   * A runtime service: when its containers last started — the end of its newest deploy, start or
   * restart in the project's process history, or its active version's activation, the newest;
   * `null` where none is known.
   */
  readonly startedAt: string | null;
}

export interface VaultValue {
  /** The platform's row id: what an update or a removal names. */
  readonly id: string;
  readonly key: string;
  readonly sensitive: boolean;
  /** The plain value; `null` for a sensitive one, which Mate never reads. */
  readonly value: string | null;
  /** When the platform made it, and when it last wrote it. */
  readonly createdAt: string | null;
  readonly changedAt: string | null;
  /** Made by Zerops (a managed service's credentials): read only, used as `${host_key}`. */
  readonly madeByZerops: boolean;
  /** The services that read it at run, and whether each runs it. */
  readonly readers: ReadonlyArray<VaultReader>;
}

export interface VaultReader {
  readonly serviceId: string;
  readonly hostname: string;
  /** The reader's zerops.yml keys that read it, directly or through a chain. */
  readonly via: ReadonlyArray<string>;
  /**
   * `live`: its containers started after the value last changed; `restart`: they started before —
   * it runs the previous value until it restarts; `unknown`: no start is known.
   */
  readonly state: "live" | "restart" | "unknown";
}

/** One deployed zerops.yml run entry of a runtime service. */
export interface VaultRead {
  readonly key: string;
  /** As deployed: `${db_password}`, `https://${API_HOST}/v1`, `production`. */
  readonly template: string;
  /** Each reference in it, in order, and where it resolves. */
  readonly refs: ReadonlyArray<VaultRef>;
}

/** Where one `${name}` in a run entry resolves, by the platform's precedence. */
export type VaultRef =
  /** A vault value: the service's own, else Shared, or another service's (`${host_KEY}`). */
  | {
      readonly kind: "value";
      readonly name: string;
      readonly scope: VaultScopeRef;
      readonly key: string;
    }
  /** Another run entry of the same service: its references pass the value on. */
  | { readonly kind: "entry"; readonly name: string; readonly key: string }
  /** Made by Zerops: a service's `hostname`, a database's `password`, the project's subdomain. */
  | { readonly kind: "platform"; readonly name: string }
  /** `KEY: ${KEY}`: the entry shadows the value it names and reaches the app as the literal text. */
  | { readonly kind: "self"; readonly name: string }
  /** Nothing has it: the app reads the literal text `${name}`. */
  | { readonly kind: "missing"; readonly name: string };

/** One fact that is not live yet, with what makes it live. */
export type VaultNotLive =
  /** Its containers started before these values changed: a restart applies them. */
  | {
      readonly kind: "restart";
      readonly serviceId: string;
      readonly hostname: string;
      readonly keys: ReadonlyArray<string>;
    }
  /**
   * Written after the project's newest deploy and nothing reads it: a zerops.yml reference and a
   * deploy make it live.
   */
  | { readonly kind: "unread"; readonly scope: VaultScopeRef; readonly key: string }
  /** A run entry references a name nothing has: the app reads the literal text. */
  | {
      readonly kind: "missing";
      readonly serviceId: string;
      readonly hostname: string;
      readonly entry: string;
      readonly name: string;
    }
  /** A run entry references its own name (`KEY: ${KEY}`): the app reads the literal text. */
  | {
      readonly kind: "self";
      readonly serviceId: string;
      readonly hostname: string;
      readonly entry: string;
    };

/** One write to one vault: the payload of a `vault-write` operation. */
export type VaultWrite =
  | {
      readonly kind: "add";
      readonly key: string;
      readonly value: string;
      readonly sensitive: boolean;
    }
  /**
   * A new value for a value held (its key unchanged). `sensitive` is always sent: Zerops turns a
   * sensitive value plain when a write leaves it out (measured 2026-10-07).
   */
  | {
      readonly kind: "update";
      readonly id: string;
      readonly key: string;
      readonly value: string;
      readonly sensitive: boolean;
    }
  | { readonly kind: "remove"; readonly id: string; readonly key: string };

/** What a write means for the services that read the value, read off the view at once. */
export interface VaultImpact {
  /** Runtime services that read it at run: after the write they run the previous value until restarted. */
  readonly restart: ReadonlyArray<{ readonly serviceId: string; readonly hostname: string }>;
  /** Nothing reads it: it needs a zerops.yml reference and a deploy to be live. */
  readonly unread: boolean;
  /** A removal: services that read it would get the literal text `${KEY}` after their next start. */
  readonly literal: ReadonlyArray<{ readonly serviceId: string; readonly hostname: string }>;
  /**
   * Read off a view that was not whole (`VaultView.complete` false): more may read it than listed,
   * and `unread` is never claimed. Absent where the view was whole.
   */
  readonly partial?: true;
}

/** One vault change since a moment, for the note a Mate's agent hears (never the value). */
export interface VaultChange {
  readonly scope: VaultScopeRef;
  /** `null` for Shared. */
  readonly hostname: string | null;
  readonly key: string;
  readonly kind: "added" | "changed" | "removed";
  readonly sensitive: boolean;
  readonly at: string;
  readonly impact: VaultImpact;
}
