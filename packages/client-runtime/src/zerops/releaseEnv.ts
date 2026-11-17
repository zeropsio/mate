/**
 * What a release's code reads from production's vault, before production runs it: each service's
 * zerops.yaml at the commit the release deploys, and in it the setup production deploys — the one
 * HQ's Core deploys with, the production tier's `zeropsSetup` for the service, else its hostname —
 * its `run.envVariables` and `build.envVariables`, as `extends` assembles them. Core reads
 * `zerops.yaml` first, then `zerops.yml`; so does the release's review.
 *
 * Pure: no network, no clock.
 *
 * @module releaseEnv
 */
import { fromYaml } from "@t3tools/shared/schemaYaml";
import * as Schema from "effect/Schema";

import { appRecipeOf } from "./groupDeploys.ts";
import { recipeTierSetups } from "./recipeTier.ts";

/** The names Core reads a commit's deploy file under, in its order. */
export const ZEROPS_YAML_NAMES = ["zerops.yaml", "zerops.yml"] as const;

/** One service the release deploys, and where its deploy file is read. */
export interface ReleaseReadTarget {
  readonly hostname: string;
  /** The application's repository it builds from, as HQ names it. */
  readonly repository: string;
  readonly sha: string;
  /** The zerops.yaml setup production deploys it with. */
  readonly setup: string;
}

/**
 * Where each service a release deploys reads its deploy file: its repository from the production
 * tier, at the commit the release deploys. A service the tier builds from no repository of the
 * application is not read.
 */
export function releaseReadTargets(
  productionTier: string,
  deploys: ReadonlyArray<{ readonly service: string; readonly sha: string }>,
): ReadonlyArray<ReleaseReadTarget> {
  const { productionRepositories } = appRecipeOf({ stage: null, production: productionTier });
  const setups = recipeTierSetups(productionTier);
  return deploys.flatMap(({ service, sha }) => {
    const repository = productionRepositories.get(service);
    return repository === undefined
      ? []
      : [{ hostname: service, repository, sha, setup: setups.get(service) ?? service }];
  });
}

/** A setup's environment entries, key → template, in the file's order. */
export interface SetupEnv {
  readonly run: ReadonlyArray<readonly [string, string]>;
  readonly build: ReadonlyArray<readonly [string, string]>;
}

const decodeYaml = Schema.decodeUnknownOption(fromYaml(Schema.Unknown));

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

/** A section's `envVariables`, scalars as the platform reads them. */
const envOf = (section: unknown): ReadonlyArray<readonly [string, string]> =>
  Object.entries(record(record(section)?.envVariables) ?? {}).flatMap(([key, value]) =>
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? [[key, String(value)] as const]
      : [],
  );

/** Each base's entries first, then its own over them. */
const merged = (
  bases: ReadonlyArray<ReadonlyArray<readonly [string, string]>>,
): ReadonlyArray<readonly [string, string]> => {
  const into = new Map<string, string>();
  for (const entries of bases) for (const [key, template] of entries) into.set(key, template);
  return [...into];
};

/**
 * The setup's entries in a zerops.yaml, with what it `extends`; `undefined` where the file does
 * not read as one or holds no such setup — what the platform would refuse is not guessed at.
 */
export function zeropsYamlSetupEnv(yaml: string, setup: string): SetupEnv | undefined {
  const decoded = decodeYaml(yaml);
  if (decoded._tag === "None") return undefined;
  const list = record(decoded.value)?.zerops;
  if (!Array.isArray(list)) return undefined;
  const setups = new Map<string, Readonly<Record<string, unknown>>>();
  for (const item of list) {
    const entry = record(item);
    if (typeof entry?.setup === "string") setups.set(entry.setup, entry);
  }
  const assemble = (name: string, seen: ReadonlySet<string>): SetupEnv | undefined => {
    const entry = setups.get(name);
    if (entry === undefined || seen.has(name)) return undefined;
    const names =
      typeof entry.extends === "string"
        ? [entry.extends]
        : Array.isArray(entry.extends)
          ? entry.extends.filter((base): base is string => typeof base === "string")
          : [];
    const bases: Array<SetupEnv> = [];
    for (const base of names) {
      const env = assemble(base, new Set([...seen, name]));
      if (env === undefined) return undefined;
      bases.push(env);
    }
    return {
      run: merged([...bases.map((base) => base.run), envOf(entry.run)]),
      build: merged([...bases.map((base) => base.build), envOf(entry.build)]),
    };
  };
  return assemble(setup, new Set());
}
