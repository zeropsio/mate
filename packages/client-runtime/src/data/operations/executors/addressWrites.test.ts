import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { addressWritesExecutor, type AddressPlatform } from "./addressWrites.ts";

const ORG = "org";
const PROJECT = "p1";

/** A platform that records each call and answers as `answers` says, else as Zerops does. */
function platform(answers: Partial<Record<keyof AddressPlatform, () => Promise<unknown>>> = {}) {
  const calls: Array<{ readonly verb: string; readonly args: ReadonlyArray<unknown> }> = [];
  const verb =
    <A>(name: keyof AddressPlatform, fallback: A) =>
    (...args: ReadonlyArray<unknown>) => {
      calls.push({ verb: name, args });
      const answer = answers[name];
      return (answer === undefined ? Promise.resolve(fallback) : answer()) as Promise<A>;
    };
  const fake: AddressPlatform = {
    createPublicHttpRouting: verb("createPublicHttpRouting", undefined),
    updatePublicHttpRouting: verb("updatePublicHttpRouting", undefined),
    deletePublicHttpRouting: verb("deletePublicHttpRouting", undefined),
    checkPublicHttpRoutingDns: verb("checkPublicHttpRoutingDns", undefined),
    disableSubdomainAccess: verb("disableSubdomainAccess", { processId: "proc-2" }),
    createPublicPortRouting: verb("createPublicPortRouting", undefined),
    updatePublicPortRouting: verb("updatePublicPortRouting", undefined),
    deletePublicPortRouting: verb("deletePublicPortRouting", undefined),
    requestProjectPublicIp: verb("requestProjectPublicIp", { processId: "proc-3" }),
  };
  return { fake, calls, verbs: () => calls.map(({ verb: name }) => name) };
}

describe("a place's address writes at Zerops", () => {
  it.effect("buying the project its own IPv4 follows the process Zerops answers with", () =>
    Effect.gen(function* () {
      const { fake, verbs } = platform();
      const receipt = yield* addressWritesExecutor(fake).requestIpv4("r1", {
        kind: "request-ipv4",
        orgId: ORG,
        projectId: PROJECT,
      });
      expect(verbs()).toEqual(["requestProjectPublicIp"]);
      expect(receipt).toMatchObject({ handles: ["proc-3"], outcome: { kind: "pending" } });
    }),
  );
});
