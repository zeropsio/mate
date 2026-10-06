/** One attachment's bytes and the source's reading/refusal state. */
import { pictureId, pictureScope, type HqPictureKey } from "../families/hqPicture.ts";
import type { Projection } from "../store.ts";

export type HqPictureRead =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly blob: Blob }
  | { readonly kind: "failed"; readonly reason: string };

export const hqPicture: Projection<HqPictureKey, HqPictureRead> = {
  name: "hqPicture",
  keyOf: pictureId,
  derive: (read, key) => {
    const fact = read.fact("hqPicture", pictureId(key));
    if (fact.kind === "known") return { kind: "read", blob: fact.value };
    const stream = read.stream(pictureScope(key));
    if (fact.kind === "withheld" || stream.fault !== null)
      return { kind: "failed", reason: stream.fault?.message ?? "That picture is unavailable." };
    return { kind: "reading" };
  },
  equals: (left, right) =>
    left.kind === right.kind &&
    (left.kind === "read" && right.kind === "read"
      ? left.blob === right.blob
      : left.kind === "failed" && right.kind === "failed"
        ? left.reason === right.reason
        : true),
};
