import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { MateAttentionSource } from "./zeropsAttention.ts";

const source = { environmentId: "env", incarnation: "boot", revision: 9 };
const decode = Schema.decodeUnknownSync(MateAttentionSource);
const encode = Schema.encodeSync(MateAttentionSource);

describe("MateAttentionSource", () => {
  it.each([
    { name: "absent", input: source, epoch: 0 },
    { name: "zero", input: { ...source, epoch: 0 }, epoch: 0 },
    { name: "first counted start", input: { ...source, epoch: 1 }, epoch: 1 },
    { name: "later counted start", input: { ...source, epoch: 42 }, epoch: 42 },
  ])("decodes the $name epoch and always encodes it", ({ input, epoch }) => {
    const value = decode(input);
    expect(value).toEqual({ ...source, epoch });
    expect(encode(value)).toEqual({ ...source, epoch });
  });

  it.each([-1, 1.5, null, "1"])("rejects an invalid explicit epoch: %s", (epoch) => {
    expect(() => decode({ ...source, epoch })).toThrow();
  });
});
