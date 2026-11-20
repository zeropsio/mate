// What a stop's chips read of its running work: the shapes `data/projections/stopWork.ts`
// derives and the deployment rule reads.
import type { VersionValue } from "../serviceVersion.ts";

/** A `stack.build` running now, and the app version it builds (A11). */
export interface StopBuild {
  readonly processId: string;
  readonly serviceIds: ReadonlyArray<string>;
  readonly appVersionId: string | null;
  readonly name: string | null;
  /** When the platform created it. */
  readonly created: string;
}

/** The newest build of a service the organization's running work showed, ended: how. */
export interface EndedBuild {
  readonly processId: string;
  readonly status: string;
}

/** How the organization's running work and active versions are observed now. */
export type WorkSource =
  | { readonly kind: "observing" }
  | { readonly kind: "establishing" }
  | { readonly kind: "catching-up" }
  | { readonly kind: "refused"; readonly reason: "expired-session" | "forbidden" | "refused" };

export interface StopWork {
  readonly source: WorkSource;
  /** The running work was read whole: no build runs unseen. */
  readonly complete: boolean;
  readonly builds: ReadonlyArray<StopBuild>;
  /** Every name a build of the project gave its app version, by version id. */
  readonly names: Readonly<Record<string, string>>;
  /** By service id: the newest build of it seen running, once it ended. */
  readonly lastBuilds: Readonly<Record<string, EndedBuild>>;
  /** By service id: the version the organization's active versions hold it runs. */
  readonly active: Readonly<Record<string, VersionValue>>;
}
