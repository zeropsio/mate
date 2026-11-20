// The services the account holds of one project: the shapes the service family and
// `data/projections/services.ts` fill and the deployment rule reads.
import type { ZeropsService } from "./api/service.ts";
import type { ScopeFreshness } from "./scopeFreshness.ts";

/**
 * A service as its row says it, with the project it belongs to. A field the row states as `null`
 * is kept: a service whose active version is `null` runs nothing, which is not unsaid.
 */
export interface ServiceValue extends ZeropsService {
  readonly projectId: string;
  readonly clientId?: string;
  /** Only the active deploy's id and display label, where the listing carries them. */
  readonly userData?: ReadonlyArray<{ readonly key?: string; readonly content?: string | null }>;
}

export interface ProjectServices extends Omit<ScopeFreshness, "complete"> {
  /** The project's services by name; `undefined` until the organization's listing is read. */
  readonly services: ReadonlyArray<ServiceValue> | undefined;
}
