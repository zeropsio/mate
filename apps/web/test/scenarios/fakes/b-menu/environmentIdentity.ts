import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { ScenarioExtension } from "../../harness/scenario.ts";

const Frame = Schema.fromJsonString(Schema.Unknown);
const decodeFrame = Schema.decodeUnknownOption(Frame);
const encodeFrame = Schema.encodeSync(Frame);

export type EnvironmentBinding =
  | {
      readonly id: string;
      readonly target: { readonly kind: "zerops"; readonly projectId: string };
    }
  | {
      readonly id: string;
      readonly target: {
        readonly kind: "git";
        readonly branch: string;
        readonly delivery: "direct";
      };
    };

/** Vary actual Core navigation/detail frames, never populate its database with Git targets. */
export function environmentIdentityWire(
  bindings: Readonly<Record<string, EnvironmentBinding>> = {},
) {
  const transform = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(transform);
    if (value === null || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (
      (record.tier === "stage" || record.tier === "production") &&
      Array.isArray(record.sources)
    ) {
      const target = record.target;
      const projectId =
        target !== null && typeof target === "object" && "projectId" in target
          ? target.projectId
          : undefined;
      const binding = typeof projectId === "string" ? bindings[projectId] : undefined;
      return binding === undefined ? record : { ...record, ...binding };
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [key, transform(entry)]),
    );
  };
  const map = (encoded: string) => {
    const decoded = decodeFrame(encoded);
    if (Option.isNone(decoded)) return encoded;
    return encodeFrame(transform(decoded.value));
  };
  const install: ScenarioExtension = (drivers) => drivers.hq.mapFrames(map);
  return { install };
}
