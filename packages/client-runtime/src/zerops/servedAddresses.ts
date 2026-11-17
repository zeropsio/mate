/**
 * What a Mate is told when the addresses its application's production or stage answers on change:
 * a domain of the person's own goes live (its certificate active) or is removed, a zerops.app
 * address opens or closes. Config there that holds the old address (the app's URL, sign-in
 * callbacks, allowed origins, a public URL built into the frontend) goes stale, and the agent
 * cannot read the place's addresses itself: the owner had to type "prod domain changed to …"
 * (2026-11-17).
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module zerops/servedAddresses
 */
import type { PlaceAddresses } from "../data/projections/addresses.ts";
import { zeropsProjectOf, type CanonicalEnvironmentRow } from "./groupRows.ts";

/** A place of the Mate's application whose addresses its agent hears of. */
export interface ServedPlace {
  readonly projectId: string;
  readonly tier: "production" | "stage";
  /** How a note names it: "Production", "Stage", or "Stage beta" where the app runs several. */
  readonly label: string;
}

/**
 * Production, and the stage a merge lands on first (else the first), where each runs in a Zerops
 * project. An environment HQ delivers to a Git branch answers on no address of ours.
 */
export function servedPlaces(
  environments: ReadonlyArray<Pick<CanonicalEnvironmentRow, "target" | "tier" | "name" | "source">>,
): ReadonlyArray<ServedPlace> {
  const production = zeropsProjectOf(environments.find((entry) => entry.tier === "production"));
  const stages = environments.filter(
    (entry) => entry.tier === "stage" && zeropsProjectOf(entry) !== undefined,
  );
  const stage = stages.find((entry) => entry.source === "main") ?? stages[0];
  const stageProject = zeropsProjectOf(stage);
  return [
    ...(production === undefined
      ? []
      : [{ projectId: production, tier: "production" as const, label: "Production" }]),
    ...(stage === undefined || stageProject === undefined
      ? []
      : [
          {
            projectId: stageProject,
            tier: "stage" as const,
            label: stages.length === 1 ? "Stage" : `Stage ${stage.name}`,
          },
        ]),
  ];
}

/**
 * The addresses a place answers on now, each once and sorted: its own domains that are live, and
 * each zerops.app address that is on. `undefined` until its routings and services are read.
 */
export function servedUrls(place: PlaceAddresses): ReadonlyArray<string> | undefined {
  if (place.state !== "ready") return undefined;
  const urls = new Set([
    ...place.domains.filter((domain) => domain.face === "live").map((domain) => domain.url),
    ...place.zerops.flatMap((address) => (address.on ? address.hosts.map((host) => host.url) : [])),
  ]);
  return [...urls].sort((left, right) => left.localeCompare(right, "en"));
}

/** What the agent was last told a place answers on. */
export interface ToldAddresses {
  /** Each address by `keyOf`: what survives a reload. */
  readonly keys: ReadonlySet<string>;
  /** The addresses themselves, where this tab still holds them: a gone one is named from these. */
  readonly urls: ReadonlyArray<string>;
}

const listed = (urls: ReadonlyArray<string>) => urls.join(", ");

/**
 * "Production now answers on https://shop.example (before: https://app-1a2b-3000.prg1.zerops.app,
 * still on).", or nothing when the place answers on what the agent was last told. A gone address
 * this tab no longer holds is said without its name.
 */
export function servedAddressNote(
  label: string,
  told: ToldAddresses,
  now: ReadonlyArray<string>,
  keyOf: (url: string) => string,
): string | undefined {
  const nowKeys = new Set(now.map(keyOf));
  const added = now.filter((url) => !told.keys.has(keyOf(url)));
  const kept = now.filter((url) => told.keys.has(keyOf(url)));
  const goneKeys = new Set([...told.keys].filter((key) => !nowKeys.has(key)));
  if (added.length === 0 && goneKeys.size === 0) return undefined;
  const goneNamed = told.urls.filter((url) => goneKeys.has(keyOf(url)));
  const unnamed = goneKeys.size - goneNamed.length;
  const gone =
    unnamed === 0
      ? listed(goneNamed)
      : goneNamed.length > 0
        ? `${listed(goneNamed)} and ${String(unnamed)} more`
        : unnamed === 1
          ? "an address it answered on before"
          : `${String(unnamed)} addresses it answered on before`;
  if (added.length > 0) {
    const stopped = goneKeys.size === 0 ? "" : ` and no longer on ${gone}`;
    const still =
      kept.length === 0
        ? ""
        : goneKeys.size === 0
          ? ` (before: ${listed(kept)}, still on)`
          : ` (still on: ${listed(kept)})`;
    return `${label} now answers on ${listed(added)}${stopped}${still}.`;
  }
  return kept.length === 0
    ? `${label} no longer answers on ${gone}: it has no public address now.`
    : `${label} no longer answers on ${gone} (still on: ${listed(kept)}).`;
}

/** What the agent may do of it, once with the notes: where the changed places are. */
export function servedAddressAdvice(tiers: ReadonlyArray<ServedPlace["tier"]>): string {
  const where = tiers.includes("production")
    ? tiers.includes("stage")
      ? "production or stage"
      : "production"
    : "stage";
  return `Anything ${where} reads that holds an old address (app URL, sign-in callbacks, allowed origins, a public URL built into the frontend) may need changing: values via zerops_propose_env, build-time ones via a change and a release.`;
}
