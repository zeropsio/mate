/**
 * What each stop's services run (DESIGN §4.7, D6), as surfaces read it: the stop's service listing
 * from the data runtime (services are not a family of the account's store yet), joined with the
 * store's word on its running work and its services' versions (`stopWork`). Nothing here holds a
 * fact: a name outlives its build because the store keeps the ended process, and a stop reads again
 * whenever what it reads changes.
 *
 * What it does hold is the services demand of each drawn stop: summary demand while a surface draws
 * it, the project's topology while one opens it, and the platform's refusal to take that demand,
 * which fails the stop until a manual Again. A stop nobody demands reads `unread`.
 *
 * @module zerops/account/stops
 */
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { stopWork, type StopWork } from "../../data/projections/stopWork.ts";
import { accountReadsAtom } from "../../data/reads.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import { projectKeyOf, type ProjectRef } from "../data/types.ts";
import {
  listedVersions,
  stopServices,
  unnamedVersions,
  type DemandRefusal,
  type StopService,
} from "../flow/deployment.ts";
import type { Known, Shown } from "../knowledge/known.ts";

export interface Stops {
  /** The stop's runtime services and what each runs; `unread` while nobody demands it. */
  readonly services: (project: ProjectRef) => Atom.Atom<Shown<ReadonlyArray<StopService>>>;
  /** Shows the stop until the returned release; `detail` adds its project's topology. */
  readonly demand: (project: ProjectRef, scope?: "summary" | "detail") => () => void;
  /** One manual attempt for a stop a view still shows. */
  readonly again: (project: ProjectRef) => void;
  /** The account closed: every demand is let go. */
  readonly dispose: () => void;
}

/** How a stop is demanded now, as its read follows it. */
interface Demanded {
  readonly project: ProjectRef;
  readonly detail: boolean;
  readonly refused: DemandRefusal | null;
}

interface Entry {
  readonly project: ProjectRef;
  leases: number;
  detailLeases: number;
  refused: DemandRefusal | null;
  /** How often the platform refused the demand; it keeps a demand it admitted. */
  refusals: number;
  unfollow: () => void;
}

const UNREAD: Known<never> = { state: "unread", waitingFor: null };

/** The store's word before an account is mounted: nothing read, nothing complete. */
const NOT_READ: StopWork = {
  source: { kind: "establishing" },
  complete: false,
  builds: [],
  names: {},
  lastBuilds: {},
  versions: {},
  active: {},
};

export function makeStops(
  data: ManagedZeropsDataRuntime,
  atomRegistry: AtomRegistry.AtomRegistry,
  /** The account's services, which the demand runs with. */
  services: Context.Context<never>,
): Stops {
  const run = Effect.runForkWith(services);
  const entries = new Map<string, Entry>();
  let disposed = false;

  const demandedAtom = Atom.family((_key: string) =>
    Atom.make<Demanded | null>(null).pipe(Atom.keepAlive),
  );
  const publish = (key: string, entry: Entry | undefined): void =>
    atomRegistry.set(
      demandedAtom(key),
      entry === undefined
        ? null
        : { project: entry.project, detail: entry.detailLeases > 0, refused: entry.refused },
    );

  const servicesAtom = Atom.family((key: string) =>
    Atom.make((get): Shown<ReadonlyArray<StopService>> => {
      const demanded = get(demandedAtom(key));
      if (demanded === null) return UNREAD;
      const project = demanded.project;
      const listing = get(data.reads.servicesOf(project));
      const account = get(accountReadsAtom);
      const work =
        account === null || account.orgId === null
          ? NOT_READ
          : get(
              account.data.project(stopWork, {
                orgId: account.orgId,
                projectId: project.projectId,
                services: listedVersions(listing),
              }),
            );
      return stopServices(
        {
          services: listing,
          work,
          refused: demanded.refused,
          stated: new Map(
            unnamedVersions(listing, work.names).map(({ service, versionId }) => [
              versionId,
              get(data.reads.deployedVersion(service)),
            ]),
          ),
          detail: demanded.detail,
        },
        data.access.clock.currentTimeMillisUnsafe(),
      );
    }),
  );

  /** Asks for the stop's demand; a refusal fails the stop until it is asked for again. */
  const follow = (key: string, entry: Entry): void => {
    const project = entry.project;
    const lease = run(
      Effect.scoped(
        data
          .acquire({
            kind: entry.detailLeases > 0 ? "project-topology" : "project-inventory",
            project,
          })
          .pipe(Effect.andThen(Effect.never)),
      ).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            if (disposed || entries.get(key) !== entry) return;
            entry.refused = { reason: error.reason, attempt: ++entry.refusals };
            publish(key, entry);
          }),
        ),
      ),
    );
    entry.unfollow = () => run(Fiber.interrupt(lease));
  };

  const refollow = (key: string, entry: Entry): void => {
    entry.unfollow();
    follow(key, entry);
    publish(key, entry);
  };

  return {
    services: (project) => servicesAtom(projectKeyOf(project)),
    demand: (project, scope = "summary") => {
      if (disposed) return () => undefined;
      const key = projectKeyOf(project);
      let entry = entries.get(key);
      if (entry === undefined) {
        const created: Entry = {
          project,
          leases: 0,
          detailLeases: scope === "detail" ? 1 : 0,
          refused: null,
          refusals: 0,
          unfollow: () => undefined,
        };
        // Held before it is followed: a demand refused as it is taken reaches the entry.
        entries.set(key, created);
        follow(key, created);
        publish(key, created);
        entry = created;
      } else if (scope === "detail") {
        entry.detailLeases += 1;
        if (entry.detailLeases === 1) refollow(key, entry);
      }
      const held = entry;
      held.leases += 1;
      let released = false;
      return () => {
        if (released || disposed) return;
        released = true;
        held.leases -= 1;
        if (scope === "detail") held.detailLeases -= 1;
        if (held.leases > 0) {
          if (scope === "detail" && held.detailLeases === 0) refollow(key, held);
          return;
        }
        held.unfollow();
        entries.delete(key);
        publish(key, undefined);
      };
    },
    again: (project) => {
      if (disposed) return;
      const key = projectKeyOf(project);
      const entry = entries.get(key);
      if (entry === undefined) return;
      const refused = entry.refused;
      entry.unfollow();
      follow(key, entry);
      // Refused again as it was asked, the stop already published its new refusal.
      if (entry.refused !== refused) return;
      entry.refused = null;
      publish(key, entry);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const [key, entry] of entries) {
        entry.unfollow();
        publish(key, undefined);
      }
      entries.clear();
    },
  };
}
