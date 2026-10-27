import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { HqMatesMessage, HqMatesSnapshot } from "./hqMates.ts";

const AT = "2026-10-03T10:00:00.000Z";

const roundTrip = <S extends Schema.Codec<unknown, unknown>>(schema: S, value: unknown) => {
  const codec = Schema.fromJsonString(schema);
  const decoded = Schema.decodeUnknownExit(codec)(JSON.stringify(value));
  return decoded._tag === "Success"
    ? JSON.parse(Schema.encodeSync(codec)(decoded.value))
    : decoded._tag;
};

describe("hqMates", () => {
  it("round-trips a Mate's view and the people map", () => {
    const snapshot = {
      mates: {
        P_ADA: {
          presence: { online: false, since: AT, overview: "stored" },
          identity: { environmentId: "env-ada", serverVersion: "0.11.90", update: null },
          main: null,
          threads: { list: [], omitted: 0 },
          logins: { codex: { signedInBy: "U1", present: true, token: false } },
          crew: { status: "off" },
        },
        // Online, and no overview from it: a Mate from before the overview.
        P_BEA: { presence: { online: true, since: AT, overview: "none" } },
      },
      // A person named by an OWNER entry carries the member id the entry names.
      people: { U1: { name: "Ada Lovelace", clientUserId: "C1" }, U2: { name: "Bo" } },
    };
    expect(roundTrip(HqMatesSnapshot, snapshot)).toEqual(snapshot);

    for (const message of [
      {
        type: "mate",
        projectId: "P_ADA",
        value: { presence: { online: true, since: AT, overview: "live" } },
      },
      { type: "mate", projectId: "P_ADA", value: { main: null, crew: { status: "none" } } },
      { type: "mate", projectId: "P_BEA", value: null },
      { type: "people", people: { U1: { name: "Ada Lovelace" } } },
    ]) {
      expect(roundTrip(HqMatesMessage, message)).toEqual(message);
    }
    expect(
      roundTrip(HqMatesMessage, { type: "mate", projectId: "P_ADA", value: { presence: {} } }),
    ).toBe("Failure");
  });
});
