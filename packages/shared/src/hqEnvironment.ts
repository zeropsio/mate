import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

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
