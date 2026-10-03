/**
 * A tier's services as a recipe delta reads them (main D15): each one's whole declaration, kept to
 * import it into an environment that lacks it, and canonicalised — its keys in one order — to tell a
 * changed declaration from a reordering. What a delta imports is created empty: a runtime built from
 * HQ's own repository loses its build and starts without code, for the platform cannot clone HQ's
 * repository and HQ deploys it; a public build keeps its build, which the platform makes itself; a
 * managed service passes through as declared.
 *
 * @module recipeDeltas
 */
import { fromYaml } from "@t3tools/shared/schemaYaml";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

export interface TierService {
  readonly hostname: string;
  /** Its declaration as the tier writes it. */
  readonly declaration: Readonly<Record<string, unknown>>;
  /** Its declaration canonicalised: what two readings compare by. */
  readonly block: string;
}

export type TierServices =
  | { readonly ok: true; readonly services: ReadonlyArray<TierService> }
  | { readonly ok: false; readonly problem: "not_yaml" | "invalid" | "hostname_twice" };

const Services = Schema.Struct({
  services: Schema.optionalKey(
    Schema.NullOr(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))),
  ),
});
const parse = Schema.decodeUnknownExit(fromYaml(Schema.Unknown));
const decodeServices = Schema.decodeUnknownExit(Services);
const render = Schema.encodeSync(fromYaml(Schema.Unknown));
const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** A value with every mapping's keys in one order. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
};

export function tierServices(importYaml: string): TierServices {
  const parsed = parse(importYaml);
  if (Exit.isFailure(parsed)) return { ok: false, problem: "not_yaml" };
  const decoded = decodeServices(parsed.value);
  if (Exit.isFailure(decoded)) return { ok: false, problem: "invalid" };
  const declarations = decoded.value.services ?? [];
  if (declarations.some((declaration) => typeof declaration["hostname"] !== "string")) {
    return { ok: false, problem: "invalid" };
  }
  const services = declarations.map((declaration) => ({
    hostname: declaration["hostname"] as string,
    declaration,
    block: toJson(canonical(declaration)),
  }));
  const hostnames = new Set(services.map((service) => service.hostname));
  return hostnames.size === services.length
    ? { ok: true, services }
    : { ok: false, problem: "hostname_twice" };
}

/**
 * Whether a build is a public one the platform makes itself at import (main D19): https on
 * github.com or gitlab.com, with no credential, port, query or fragment.
 */
export function isPublicBuild(buildFromGit: string): boolean {
  let url: URL;
  try {
    url = new URL(buildFromGit.trim());
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    url.search === "" &&
    url.hash === "" &&
    (url.hostname === "github.com" || url.hostname === "gitlab.com")
  );
}

/** The platform evaluates a directive (`<@generateRandomString(<32>)>`) only under this header. */
const PREPROCESSOR = "#zeropsPreprocessor=on\n";

/**
 * Whether HQ deploys the service `declaration` declares: a runtime built from HQ's own repository —
 * neither a public build the platform makes itself, nor a managed service.
 */
export function deployedByHq(declaration: Readonly<Record<string, unknown>>): boolean {
  const build = declaration["buildFromGit"];
  if (typeof build === "string" && isPublicBuild(build)) return false;
  const managed =
    build === undefined &&
    declaration["zeropsSetup"] === undefined &&
    declaration["startWithoutCode"] === undefined;
  return !managed;
}

/** The services-only import that creates `services` in a project, empty where HQ deploys them. */
export function deltaImport(services: ReadonlyArray<TierService>): string {
  const declared = services.map(({ declaration }) => {
    if (!deployedByHq(declaration)) return declaration;
    const {
      buildFromGit: _build,
      zeropsSetup: _setup,
      startWithoutCode: _empty,
      ...kept
    } = declaration;
    return { ...kept, startWithoutCode: true };
  });
  const document = render({ services: declared });
  return document.includes("<@") ? `${PREPROCESSOR}${document}` : document;
}
