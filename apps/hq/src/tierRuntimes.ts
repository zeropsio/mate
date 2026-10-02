/**
 * The runtimes a tier deploys (main B10, B11): of the services its `import.yaml` declares, those
 * built from one of the application's own repositories in HQ (`buildFromGit` on
 * `…/git/<appId>/<repo>.git`, SPEC §3.2c) that name a `zeropsSetup` — never a database, a public
 * build the platform makes itself, or another application's repository. A service maps to its
 * repository by that address, never by its hostname (`appdev` builds `app`). Higher `priority`
 * first, as the platform builds them; ties in the file's order.
 *
 * @module tierRuntimes
 */
import { fromYaml } from "@t3tools/shared/schemaYaml";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

export interface TierRuntime {
  readonly hostname: string;
  /** The application's repository it is built from. */
  readonly repo: string;
  readonly zeropsSetup: string;
  readonly priority: number;
}

export type TierRead =
  | { readonly ok: true; readonly runtimes: ReadonlyArray<TierRuntime> }
  | { readonly ok: false; readonly problem: "not_yaml" | "invalid" | "hostname_twice" };

const ImportFile = Schema.Struct({
  services: Schema.optionalKey(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          hostname: Schema.String,
          buildFromGit: Schema.optionalKey(Schema.NullOr(Schema.String)),
          zeropsSetup: Schema.optionalKey(Schema.NullOr(Schema.String)),
          priority: Schema.optionalKey(Schema.NullOr(Schema.Number)),
        }),
      ),
    ),
  ),
});
const parseYaml = Schema.decodeUnknownExit(fromYaml(Schema.Unknown));
const decodeImport = Schema.decodeUnknownExit(ImportFile);

/** The repository of the application `appId` an address names: its last two segments. */
const repoOf = (buildFromGit: string, appId: string): string | undefined => {
  let parsed: URL;
  try {
    parsed = new URL(buildFromGit.trim());
  } catch {
    return undefined;
  }
  const segments = parsed.pathname
    .replace(/\/+$/u, "")
    .replace(/\.git$/u, "")
    .split("/");
  const [owner, name] = segments.slice(-2);
  return owner === appId && name !== undefined && name !== "" ? name : undefined;
};

export function tierRuntimes(importYaml: string, appId: string): TierRead {
  const parsed = parseYaml(importYaml);
  if (Exit.isFailure(parsed)) return { ok: false, problem: "not_yaml" };
  const decoded = decodeImport(parsed.value);
  if (Exit.isFailure(decoded)) return { ok: false, problem: "invalid" };
  const services = decoded.value.services ?? [];
  const hostnames = services.map((service) => service.hostname);
  if (new Set(hostnames).size !== hostnames.length) return { ok: false, problem: "hostname_twice" };
  const runtimes = services.flatMap((service): ReadonlyArray<TierRuntime> => {
    const repo = repoOf(service.buildFromGit ?? "", appId);
    const zeropsSetup = service.zeropsSetup ?? "";
    return repo === undefined || zeropsSetup === ""
      ? []
      : [{ hostname: service.hostname, repo, zeropsSetup, priority: service.priority ?? 0 }];
  });
  return { ok: true, runtimes: runtimes.toSorted((a, b) => b.priority - a.priority) };
}
