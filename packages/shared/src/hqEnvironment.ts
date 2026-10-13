import { HqEnvironmentId, ProjectId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

export const HqEnvironmentTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("zerops"), projectId: ProjectId }),
  Schema.Struct({
    kind: Schema.Literal("git"),
    branch: TrimmedNonEmptyString,
    delivery: Schema.Literals(["direct", "pr"]),
  }),
]);
export type HqEnvironmentTarget = typeof HqEnvironmentTarget.Type;

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
