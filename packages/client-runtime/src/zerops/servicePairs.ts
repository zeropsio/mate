/**
 * Which of a Mate's services are one pair: a dev service and the previews its code runs in
 * (spec-mate §10.10; the monorepo model, §9/3m). Every surface that folds a preview under its dev,
 * lists one repository per codebase, names a preview or stands a pair up reads it here.
 *
 * One reader, its sources in order, the first that pairs a preview winning:
 *
 * 1. **The Mate tier on `main`** — the recipe a person approved. A dev runtime and the stage
 *    runtimes built from the same repository (`buildFromGit`) are one pair, and each preview is
 *    the part its `zeropsSetup` names.
 * 2. **The Mate's open recipe change** — the same tier as zcp proposed it, not merged yet: a
 *    preview only it pairs is one that waits for recipe approval (`source: "recipe"`).
 * 3. **The hostname stem** — `{name}stage` beside `{name}dev`, or beside `{name}` when zcp later
 *    expanded a single service into a pair (Dara's `todoapp` with `todoappstage`, 2026-09-17) —
 *    only for a preview neither tier declares: a pair zcp has not proposed to a tier yet, whose
 *    pairing a person had before the tier read it (the model's §11.3; it goes once zcp proposes
 *    every pair as it wires it).
 *
 * Pairing is within a group: a `cachestage` data service is not the stage half of a `cachedev`
 * runtime, whatever the names suggest. A preview a tier declares never falls to the stem: when no
 * source's dev half stands beside it, it is in no pair.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module servicePairs
 */
import { isPoolOrSandboxServiceType } from "./infrastructureType.ts";
import {
  isStageHostname,
  recipeTierRepositories,
  recipeTierServices,
  recipeTierSetups,
} from "./recipeTier.ts";

export { isStageHostname };

/** Where a preview's pairing comes from: the tier on `main`, an open recipe change, the stem. */
export type ServicePairSource = "tier" | "recipe" | "stem";

export interface ServicePreview {
  readonly hostname: string;
  /** The `zeropsSetup` it builds with, as the tier names it; the stem names none. */
  readonly setup: string | undefined;
  readonly source: ServicePairSource;
}

export interface ServicePair {
  /** The pair's name: its dev half's hostname without `dev` — `app` for `appdev`. */
  readonly name: string;
  readonly dev: string;
  /** Its previews, in the project's order. */
  readonly previews: ReadonlyArray<ServicePreview>;
}

export interface ServicePairing {
  /** Every pair, in the project's order of their dev halves. */
  readonly pairs: ReadonlyArray<ServicePair>;
  /** Each preview's dev half, by the preview's hostname. */
  readonly devOf: ReadonlyMap<string, string>;
  /**
   * A further dev service of a pair (variant B: one dev service per part, one shared code
   * volume), by its hostname: the pair's first dev half, the only one that is its repository.
   */
  readonly sharesCodeWith: ReadonlyMap<string, string>;
}

export interface ServicePairsInput {
  /** The project's services, in its order; a service without a group pairs with another without. */
  readonly services: ReadonlyArray<{
    readonly hostname: string;
    readonly group?: string;
    /**
     * The type-version string. A pool or a Box is infrastructure an app uses, never a dev or a
     * preview half, whatever its name and category say; a caller that omits the type keeps the
     * name-and-group reading.
     */
    readonly type?: string;
  }>;
  /** The Mate tier as `main` holds it. */
  readonly tier?: string | undefined;
  /** The Mate tier as the Mate's open recipe change holds it. */
  readonly proposal?: string | undefined;
}

const STAGE_SUFFIX = "stage";
const DEV_SUFFIX = "dev";

const pairName = (dev: string): string =>
  dev.length > DEV_SUFFIX.length && dev.endsWith(DEV_SUFFIX)
    ? dev.slice(0, -DEV_SUFFIX.length)
    : dev;

interface Declared {
  readonly dev: string;
  readonly setup: string | undefined;
}

/** The previews a tier pairs, by hostname: each stage runtime with the dev built from its repository. */
function declaredPairs(yaml: string | undefined): ReadonlyMap<string, Declared> {
  if (yaml === undefined) return new Map();
  const services = recipeTierServices(yaml) ?? [];
  const repositories = recipeTierRepositories(yaml);
  const setups = recipeTierSetups(yaml);
  const devByRepository = new Map<string, string>();
  for (const { hostname, role } of services) {
    const repository = repositories.get(hostname);
    if (role === "dev" && repository !== undefined && !devByRepository.has(repository))
      devByRepository.set(repository, hostname);
  }
  const declared = new Map<string, Declared>();
  for (const { hostname, role } of services) {
    const dev = devByRepository.get(repositories.get(hostname) ?? "");
    if (role === "stage" && dev !== undefined)
      declared.set(hostname, { dev, setup: setups.get(hostname) });
  }
  return declared;
}

/** The dev services built from a repository an earlier dev service of the tier is built from. */
function sharedDevs(
  yaml: string | undefined,
  services: ServicePairsInput["services"],
  groupOf: ReadonlyMap<string, string | undefined>,
): ReadonlyMap<string, string> {
  const shared = new Map<string, string>();
  if (yaml === undefined) return shared;
  const repositories = recipeTierRepositories(yaml);
  const first = new Map<string, string>();
  for (const { hostname, role } of recipeTierServices(yaml) ?? []) {
    const repository = repositories.get(hostname);
    if (role !== "dev" || repository === undefined || !groupOf.has(hostname)) continue;
    const owner = first.get(repository);
    if (owner === undefined) first.set(repository, hostname);
    else if (services.some((service) => service.hostname === hostname)) shared.set(hostname, owner);
  }
  return shared;
}

/** The pairs among a project's services, from the tier on `main`, the open recipe change, the stem. */
export function servicePairs(input: ServicePairsInput): ServicePairing {
  // A pool or a Box stands outside every pair: it is in no group to pair within, so it is neither
  // a dev half nor a preview half, and a tier that declares it as a runtime pairs nothing for it.
  const pairable = input.services.filter(
    (service) => service.type === undefined || !isPoolOrSandboxServiceType(service.type),
  );
  const groupOf = new Map(pairable.map((service) => [service.hostname, service.group]));
  const beside = (preview: string, dev: string) =>
    dev !== preview && groupOf.has(dev) && groupOf.get(dev) === groupOf.get(preview);
  const sources: ReadonlyArray<readonly [ServicePairSource, ReadonlyMap<string, Declared>]> = [
    ["tier", declaredPairs(input.tier)],
    ["recipe", declaredPairs(input.proposal)],
  ];

  const pairOf = (hostname: string): { dev: string; preview: ServicePreview } | undefined => {
    let declared = false;
    for (const [source, pairs] of sources) {
      const pair = pairs.get(hostname);
      if (pair === undefined) continue;
      declared = true;
      if (beside(hostname, pair.dev))
        return { dev: pair.dev, preview: { hostname, setup: pair.setup, source } };
    }
    if (declared || !isStageHostname(hostname)) return undefined;
    const stem = hostname.slice(0, -STAGE_SUFFIX.length);
    const dev = [`${stem}${DEV_SUFFIX}`, stem].find((candidate) => beside(hostname, candidate));
    return dev === undefined
      ? undefined
      : { dev, preview: { hostname, setup: undefined, source: "stem" } };
  };

  const previewsByDev = new Map<string, Array<ServicePreview>>();
  const devOf = new Map<string, string>();
  for (const { hostname } of pairable) {
    const paired = pairOf(hostname);
    if (paired === undefined) continue;
    devOf.set(hostname, paired.dev);
    const previews = previewsByDev.get(paired.dev) ?? [];
    previews.push(paired.preview);
    previewsByDev.set(paired.dev, previews);
  }
  const sharesCodeWith = sharedDevs(input.tier, pairable, groupOf);
  const pairs = pairable.flatMap(({ hostname }) => {
    const previews = previewsByDev.get(hostname);
    return previews === undefined ? [] : [{ name: pairName(hostname), dev: hostname, previews }];
  });
  return { pairs, devOf, sharesCodeWith };
}

/** A preview's part label: its `zeropsSetup`, only where its pair has more than one preview. */
export function previewLabel(pair: ServicePair, preview: ServicePreview): string | undefined {
  return pair.previews.length > 1 ? preview.setup : undefined;
}
