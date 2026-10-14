import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { ScenarioExtension } from "../../harness/scenario.ts";

const Frame = Schema.fromJsonString(Schema.Unknown);
const decodeFrame = Schema.decodeUnknownOption(Frame);
const encodeFrame = Schema.encodeSync(Frame);

export type EnvironmentWire = "legacy" | "modern" | "partial" | "refused";
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
  initial: EnvironmentWire,
  bindings: Readonly<Record<string, EnvironmentBinding>> = {},
) {
  let wire = initial;
  const frames: string[] = [];
  const transform = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(transform);
    if (value === null || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (
      (record.tier === "stage" || record.tier === "production") &&
      Array.isArray(record.sources)
    ) {
      const { id: _id, target, ...rest } = record;
      const projectId =
        target !== null && typeof target === "object" && "projectId" in target
          ? target.projectId
          : undefined;
      const legacy = { ...rest, projectId };
      if (wire === "legacy") return legacy;
      if (wire === "partial") return { ...legacy, id: record.id };
      const binding = typeof projectId === "string" ? bindings[projectId] : undefined;
      return binding === undefined ? record : { ...record, ...binding };
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [
        key,
        key === "environments" && wire === "refused"
          ? { refused: "identity fixture refused" }
          : transform(entry),
      ]),
    );
  };
  const map = (encoded: string) => {
    const decoded = decodeFrame(encoded);
    if (Option.isNone(decoded)) return encoded;
    const mapped = encodeFrame(transform(decoded.value));
    frames.push(mapped);
    return mapped;
  };
  const install: ScenarioExtension = (drivers) => drivers.hq.mapFrames(map);
  return {
    map,
    install,
    frames,
    set: (next: EnvironmentWire) => {
      wire = next;
    },
  };
}
