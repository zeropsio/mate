/**
 * A stop's deployments join the account store's services, work and version projections.
 * A drawn stop holds its services, an opened one also its process history; versions absent
 * from the active listing are read by id. Closing the account releases every demand.
 */
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { stopWork, type StopWork } from "../../data/projections/stopWork.ts";
import {
  serviceRuns,
  type ZeropsServiceDeployedVersion,
} from "../../data/projections/serviceRuns.ts";
import { versionSource, type VersionSource } from "../../data/projections/versionSource.ts";
import type { DetailDemand } from "../../data/demand.ts";
import {
  accountReadsAtom,
  projectServicesAtom,
  holdProjectServices,
  type AccountReads,
} from "../../data/reads.ts";
import { projectKeyOf, serviceKeyOf, type ProjectRef, type ServiceRef } from "../data/types.ts";
import {
  listedVersions,
  stopServices,
  unnamedVersions,
  type StopService,
} from "../flow/deployment.ts";
import type { Known, Shown } from "../knowledge/known.ts";

export interface Stops {
  /** The stop's runtime services and what each runs; `unread` while nobody demands it. */
  readonly services: (project: ProjectRef) => Atom.Atom<Shown<ReadonlyArray<StopService>>>;
  /** Shows the stop until the returned release; `detail` adds its project's topology. */
  readonly demand: (project: ProjectRef, scope?: "summary" | "detail") => () => void;
  /**
   * What the service runs: its active version, as its own row says it and names it, with that
   * version's source from the organization's active versions where the row left it unstated.
   */
  readonly version: (service: ServiceRef) => Atom.Atom<Shown<ZeropsServiceDeployedVersion>>;
  /**
   * Holds the services' versions to be read by id where the active versions lack them, for as
   * long as a surface draws them; the release lets them go.
   */
  readonly holdVersions: (services: ReadonlyArray<ServiceRef>) => () => void;
  /** One manual attempt for a stop a view still shows. */
  readonly again: (project: ProjectRef) => void;
  /** The account closed: every demand is let go. */
  readonly dispose: () => void;
}

/** How a stop is demanded now, as its read follows it. */
interface Demanded {
  readonly project: ProjectRef;
  readonly detail: boolean;
}

interface Entry {
  readonly project: ProjectRef;
  leases: number;
  detailLeases: number;
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
  active: {},
};

export function makeStops(atomRegistry: AtomRegistry.AtomRegistry): Stops {
  const entries = new Map<string, Entry>();
  let disposed = false;

  const demandedAtom = Atom.family((_key: string) =>
    Atom.make<Demanded | null>(null).pipe(Atom.keepAlive),
  );
  /** The stops demanded now, by key. */
  const noKeys: ReadonlySet<string> = new Set();
  const demandedKeys = Atom.make({ keys: noKeys }).pipe(Atom.keepAlive);
  const publish = (key: string, entry: Entry | undefined): void => {
    atomRegistry.set(
      demandedAtom(key),
      entry === undefined ? null : { project: entry.project, detail: entry.detailLeases > 0 },
    );
    const keys = new Set(atomRegistry.get(demandedKeys).keys);
    if (entry === undefined ? keys.delete(key) : !keys.has(key) && keys.add(key))
      atomRegistry.set(demandedKeys, { keys });
  };

  /** What the active versions state of one version, through the mounted account. */
  const sourceOf = (
    get: Atom.AtomContext,
    account: AccountReads | null,
    versionId: string,
  ): VersionSource =>
    account === null || account.orgId === null
      ? { kind: "unknown" }
      : get(account.data.project(versionSource, { orgId: account.orgId, versionId }));

  /** What the service's own row says it runs, through the mounted account. */
  const runsOf = (
    get: Atom.AtomContext,
    account: AccountReads | null,
    service: ServiceRef,
  ): Shown<ZeropsServiceDeployedVersion> => {
    if (account === null || account.orgId === null) return UNREAD;
    const runs = get(
      account.data.project(serviceRuns, { orgId: account.orgId, serviceId: service.serviceId }),
    );
    if (runs === "unread") return UNREAD;
    if (runs === "absent")
      return {
        state: "failed",
        failure: {
          kind: "refused",
          code: "serviceStackNotFound",
          words: "The service is not there.",
        },
        atMs: 0,
        attempt: 1,
        retryAtMs: null,
      };
    return {
      state: "known",
      value: runs,
      asOf: { ordinal: 0, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
  };

  const servicesAtom = Atom.family((key: string) =>
    Atom.make((get): Shown<ReadonlyArray<StopService>> => {
      const demanded = get(demandedAtom(key));
      if (demanded === null) return UNREAD;
      const project = demanded.project;
      const listing = { project, ...get(projectServicesAtom(project.projectId)) };
      const account = get(accountReadsAtom);
      const listed = listedVersions(listing);
      const work =
        account === null || account.orgId === null
          ? NOT_READ
          : get(
              account.data.project(stopWork, {
                orgId: account.orgId,
                projectId: project.projectId,
                serviceIds: listed.map(({ serviceId }) => serviceId),
              }),
            );
      return stopServices(
        {
          services: listing,
          work,
          versions: new Map(
            listed.flatMap(({ versionId }) =>
              versionId === null ? [] : [[versionId, sourceOf(get, account, versionId)] as const],
            ),
          ),
          stated: new Map(
            unnamedVersions(listing, work.names).map(({ service, versionId }) => [
              versionId,
              runsOf(get, account, service),
            ]),
          ),
          detail: demanded.detail,
        },
        0,
      );
    }),
  );

  /** Each service a version was asked of, by its key. */
  const asked = new Map<string, ServiceRef>();
  /** The services a surface holds the version of now, by key, each with its holds. */
  const noServices: ReadonlyMap<string, { readonly service: ServiceRef; readonly holds: number }> =
    new Map();
  const heldServices = Atom.make({ services: noServices }).pipe(Atom.keepAlive);
  /** The version a service runs whose source its row left unstated; `null` for none. */
  const unstatedOf = (get: Atom.AtomContext, service: ServiceRef): string | null => {
    const started = runsOf(get, get(accountReadsAtom), service);
    return started.state === "known" && started.value.source === null
      ? started.value.activeId
      : null;
  };
  const versionAtom = Atom.family((key: string) =>
    Atom.make((get): Shown<ZeropsServiceDeployedVersion> => {
      const service = asked.get(key);
      if (service === undefined) return UNREAD;
      const account = get(accountReadsAtom);
      const started = runsOf(get, account, service);
      const versionId = unstatedOf(get, service);
      if (started.state !== "known" || versionId === null) return started;
      const source = sourceOf(get, account, versionId);
      switch (source.kind) {
        case "known":
          return { ...started, value: { ...started.value, source: source.source } };
        case "unknown":
        case "awaited":
          return UNREAD;
        case "not-listed":
        case "unreadable":
        case "refused":
          return {
            state: "failed",
            failure:
              source.kind === "not-listed"
                ? { kind: "malformed", detail: "Its active version is not listed." }
                : source.kind === "unreadable"
                  ? { kind: "malformed", detail: "Zerops sent an answer that couldn't be read." }
                  : { kind: "transport", detail: "Zerops refused its active versions." },
            atMs: 0,
            attempt: 1,
            retryAtMs: null,
          };
      }
    }),
  );

  /**
   * The reads held now. Each version a demanded stop's service or an asked service runs that the
   * active versions, though answered, do not hold, by id — and, once read, one the platform does
   * not have, so its refusal stays to be said. And each opened stop's process history: what its
   * earlier builds named the versions it may run again (a roll back pushes only their ids).
   */
  const wantedReads = Atom.make((get) => {
    const account = get(accountReadsAtom);
    const ids = new Set<string>();
    const histories = new Set<string>();
    const want = (versionId: string | null) => {
      if (versionId === null) return;
      const source = sourceOf(get, account, versionId);
      if (source.kind === "awaited" || source.kind === "not-listed") ids.add(versionId);
    };
    for (const key of get(demandedKeys).keys) {
      const demanded = get(demandedAtom(key));
      if (demanded === null) continue;
      if (demanded.detail) histories.add(demanded.project.projectId);
      for (const { versionId } of listedVersions({
        project: demanded.project,
        ...get(projectServicesAtom(demanded.project.projectId)),
      }))
        want(versionId);
    }
    for (const { service } of get(heldServices).services.values()) want(unstatedOf(get, service));
    const reads: ReadonlyArray<DetailDemand> = [
      ...[...ids].map((ownerId) => ({ family: "version" as const, listing: "version", ownerId })),
      ...[...histories].map((ownerId) => ({
        family: "process" as const,
        listing: "history",
        ownerId,
      })),
    ];
    return { account, reads };
  });
  /** Each read held, by family and owner, with its release, and the account holding them. */
  const reading = new Map<string, () => void>();
  let readingFrom: AccountReads | null = null;
  const releaseReads = () => {
    for (const release of reading.values()) release();
    reading.clear();
  };
  const stopWanting = atomRegistry.subscribe(
    wantedReads,
    ({ account, reads }) => {
      if (disposed) return;
      if (account !== readingFrom) {
        releaseReads();
        readingFrom = account;
      }
      if (account === null) return;
      const wanted = new Map(reads.map((read) => [`${read.family}:${read.ownerId}`, read]));
      for (const [key, release] of reading) {
        if (wanted.has(key)) continue;
        release();
        reading.delete(key);
      }
      for (const [key, read] of wanted)
        if (!reading.has(key)) reading.set(key, account.demandDetail(read));
    },
    { immediate: true },
  );

  /** Asks for the stop's demand; a refusal fails the stop until it is asked for again. */
  const follow = (entry: Entry): void => {
    entry.unfollow = holdProjectServices(atomRegistry, entry.project.projectId);
  };

  const refollow = (key: string, entry: Entry): void => {
    entry.unfollow();
    follow(entry);
    publish(key, entry);
  };

  return {
    services: (project) => servicesAtom(projectKeyOf(project)),
    version: (service) => {
      const key = serviceKeyOf(service);
      asked.set(key, service);
      return versionAtom(key);
    },
    holdVersions: (services) => {
      if (disposed) return () => undefined;
      const move = (by: 1 | -1) => {
        const held = new Map(atomRegistry.get(heldServices).services);
        for (const service of services) {
          const key = serviceKeyOf(service);
          const holds = (held.get(key)?.holds ?? 0) + by;
          if (holds > 0) held.set(key, { service, holds });
          else held.delete(key);
        }
        atomRegistry.set(heldServices, { services: held });
      };
      move(1);
      let released = false;
      return () => {
        if (released || disposed) return;
        released = true;
        move(-1);
      };
    },
    demand: (project, scope = "summary") => {
      if (disposed) return () => undefined;
      const key = projectKeyOf(project);
      let entry = entries.get(key);
      if (entry === undefined) {
        const created: Entry = {
          project,
          leases: 0,
          detailLeases: scope === "detail" ? 1 : 0,
          unfollow: () => undefined,
        };
        // Held before it is followed: a demand refused as it is taken reaches the entry.
        entries.set(key, created);
        follow(created);
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
      entry.unfollow();
      follow(entry);
      publish(key, entry);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stopWanting();
      releaseReads();
      for (const [key, entry] of entries) {
        entry.unfollow();
        publish(key, undefined);
      }
      entries.clear();
    },
  };
}
