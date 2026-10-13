import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HqRepoRemote } from "@t3tools/shared/hqChanges";
import { gitRemote } from "../__fixtures__/hqWire.ts";
import { navigationRecord } from "./navigationRecord.ts";

const read = Schema.decodeUnknownOption(
  navigationRecord({ name: Schema.String, remote: Schema.NullOr(HqRepoRemote) }),
);
describe("independent navigation evidence", () => {
  it.each([undefined, "unreadable", { ...gitRemote, keptAt: "not a timestamp" }])(
    "damaged remote evidence stays unknown beside the readable label: %s",
    (remote) => {
      expect(Option.getOrNull(read({ name: "Web", remote }))).toEqual({
        name: "Web",
        remote: undefined,
      });
    },
  );
  it("known unknown expiry stays unknown and does not infer host identity from the custodian", () => {
    expect(
      Option.getOrNull(
        read({
          name: "Web",
          remote: { ...gitRemote, token: "PROTECTED_TOKEN_MARKER", tokenOwner: "github-owner" },
        }),
      ),
    ).toEqual({ name: "Web", remote: gitRemote });
  });
  it("explicit disconnection is distinct from unreadable remote evidence", () => {
    expect(Option.getOrNull(read({ name: "Web", remote: null }))).toEqual({
      name: "Web",
      remote: null,
    });
  });
});
