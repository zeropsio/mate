import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

/** A captured PostgreSQL declaration identity, kept exact beyond JS integer precision. */
export const HqEnvironmentDeclaration = Schema.String.check(
  Schema.makeFilter((value: string) =>
    /^[1-9][0-9]{0,18}$/u.test(value) && (value.length < 19 || value <= "9223372036854775807")
      ? undefined
      : "Expected a positive declaration identity",
  ),
);

/** A branch name, not a full ref; mate/ is reserved for the later PR-head writer. */
export const HqGitBranch = Schema.String.check(
  Schema.makeFilter((branch: string) =>
    branch === "@" ||
    branch.startsWith("refs/") ||
    branch.startsWith("mate/") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    /[~^:?*[\\]/u.test(branch) ||
    [...branch].some(
      (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    ) ||
    branch.split("/").some((part) => part === "" || part.startsWith(".") || part.endsWith(".lock"))
      ? "Expected an unreserved Git branch name"
      : undefined,
  ),
);

/** Wire timestamps retain their bytes; malformed provenance is not historical unknown. */
export const HqTargetTimestamp = Schema.String.check(
  Schema.makeFilter((value: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
      ? undefined
      : "Expected an ISO timestamp",
  ),
);

/** New attachment acceptance is direct-only; the slice-1 reader still understands PR targets. */
export const HqDirectGitTarget = Schema.Struct({
  kind: Schema.Literal("git"),
  branch: HqGitBranch,
  delivery: Schema.Literal("direct"),
});
export type HqDirectGitTarget = typeof HqDirectGitTarget.Type;

export const HqEnvironmentTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("zerops"), projectId: ProjectId }),
  Schema.Struct({
    kind: Schema.Literal("git"),
    branch: HqGitBranch,
    delivery: Schema.Literals(["direct", "pr"]),
  }),
]);
export type HqEnvironmentTarget = typeof HqEnvironmentTarget.Type;

/** Destination captured at acceptance; absence on old history remains unknown. */
export const HqEnvironmentAttachment = Schema.Struct({
  environmentId: HqEnvironmentId,
  createdAt: HqTargetTimestamp,
  target: HqEnvironmentTarget,
});
export type HqEnvironmentAttachment = typeof HqEnvironmentAttachment.Type;

export const RemoveGitEnvironmentRequest = Schema.Struct({ environmentId: HqEnvironmentId });
export type RemoveGitEnvironmentRequest = typeof RemoveGitEnvironmentRequest.Type;

const identity = Schema.Struct({
  id: HqEnvironmentId,
  target: HqEnvironmentTarget,
  /** @deprecated Project addresses belong to the Zerops target. */
  projectId: Schema.optionalKey(ProjectId),
});

const legacyInput = Schema.Unknown.pipe(
  Schema.decodeTo(
    Schema.Unknown,
    SchemaTransformation.transform<unknown, unknown>({
      decode: (raw) => {
        // Presence, including malformed values, prevents legacy inference.
        if (typeof raw !== "object" || raw === null || "id" in raw || "target" in raw) return raw;
        if (!("projectId" in raw)) return raw;
        return { ...raw, id: raw.projectId, target: { kind: "zerops", projectId: raw.projectId } };
      },
      encode: (raw) => raw,
    }),
  ),
);

/** Payload fields keep their own defaults/codecs; identity is normalized once for every reader. */
export const hqEnvironmentCodec = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  legacyInput.pipe(Schema.decodeTo(Schema.Struct({ ...fields, ...identity.fields })));

export const HqEnvironmentIdentity = hqEnvironmentCodec({});
export type HqEnvironmentIdentity = typeof HqEnvironmentIdentity.Type;

export type EnvironmentTier = "stage" | "production";

/** A name a branch and a deploy ask an environment by (main D10). */
const NAME = /^[a-z][a-z0-9-]*$/u;

/**
 * The longest name, a DNS label's length: a deploy key is named `mate-hq-deploy:<env>:<projectId>`,
 * and Zerops caps a token's name at 255 characters.
 */
export const ENVIRONMENT_NAME_MAX = 63;

/** The highest number a taken name is given before there is none (main D10). */
const LAST_SUFFIX = 999;

/**
 * What an environment is called, from the name a person gave its project (main D10): diacritics
 * dropped, lower-case, every run of anything else a dash, leading non-letters and trailing dashes
 * cut; the tier when nothing is left; numbered from `-2` when taken. At most `ENVIRONMENT_NAME_MAX`
 * characters, a number included. None past `-999`.
 */
export function deriveEnvironmentName(
  projectName: string,
  tier: EnvironmentTier,
  taken: ReadonlyArray<string>,
): string | undefined {
  const cleaned = projectName
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^[^a-z]+|-+$/gu, "");
  const base = cleaned.length === 0 ? tier : cleaned;
  /** `base` cut so `rest` still fits, with no dash left at the cut. */
  const within = (rest: string) =>
    `${base.slice(0, ENVIRONMENT_NAME_MAX - rest.length).replace(/-+$/u, "")}${rest}`;
  const used = new Set(taken);
  if (!used.has(within(""))) return within("");
  for (let suffix = 2; suffix <= LAST_SUFFIX; suffix += 1) {
    const candidate = within(`-${String(suffix)}`);
    if (!used.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Why a name a person gave an environment is refused (main D11; longer than
 * `ENVIRONMENT_NAME_MAX`), or nothing.
 */
export function environmentNameProblem(
  name: string,
): "environment_name_missing" | "environment_name_long" | "environment_name_invalid" | undefined {
  if (name.trim().length === 0) return "environment_name_missing";
  if (name.length > ENVIRONMENT_NAME_MAX) return "environment_name_long";
  return NAME.test(name) ? undefined : "environment_name_invalid";
}
