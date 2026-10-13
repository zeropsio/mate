import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { ZeropsApiError } from "../../../zerops/api.ts";
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
  const sync = { processId: "proc-1" };
  const fake: AddressPlatform = {
    createPublicHttpRouting: verb("createPublicHttpRouting", undefined),
    updatePublicHttpRouting: verb("updatePublicHttpRouting", undefined),
    deletePublicHttpRouting: verb("deletePublicHttpRouting", undefined),
    checkPublicHttpRoutingDns: verb("checkPublicHttpRoutingDns", undefined),
    syncPublicHttpRouting: verb("syncPublicHttpRouting", sync),
    disableSubdomainAccess: verb("disableSubdomainAccess", { processId: "proc-2" }),
    createPublicPortRouting: verb("createPublicPortRouting", undefined),
    updatePublicPortRouting: verb("updatePublicPortRouting", undefined),
    deletePublicPortRouting: verb("deletePublicPortRouting", undefined),
    syncPublicPortRouting: verb("syncPublicPortRouting", sync),
    requestProjectPublicIp: verb("requestProjectPublicIp", { processId: "proc-3" }),
  };
  return { fake, calls, verbs: () => calls.map(({ verb: name }) => name) };
}

const refusal = (code: string) =>
  Promise.reject(new ZeropsApiError(code, "invalid-input", 400, code, `Zerops said ${code}.`));

const PORT = {
  serviceId: "s2",
  publicIpType: "IP_V6",
  publicPort: 16432,
  internalPort: 6432,
  internalProtocol: "tcp",
  firewallPolicy: "WHITELIST",
  firewallIpRanges: ["2001:db8::20/128"],
} as const;

describe("a place's address writes at Zerops", () => {
  it.effect(
    "adding a domain creates it, then puts the project's domains in place and follows that",
    () =>
      Effect.gen(function* () {
        const { fake, calls, verbs } = platform();
        const receipt = yield* addressWritesExecutor(fake).addDomain("r1", {
          kind: "add-domain",
          orgId: ORG,
          projectId: PROJECT,
          domains: ["shop.com", "www.shop.com"],
          serviceId: "s1",
          port: 3000,
        });
        expect(verbs()).toEqual(["createPublicHttpRouting", "syncPublicHttpRouting"]);
        expect(calls[0]?.args).toEqual([
          PROJECT,
          {
            domains: ["shop.com", "www.shop.com"],
            locations: [{ path: "/", port: 3000, serviceStackId: "s1" }],
          },
        ]);
        expect(receipt).toMatchObject({ handles: ["proc-1"], outcome: { kind: "pending" } });
      }),
  );

  it.effect("a sync Zerops answers nothingToSync leaves the end to what the routings show", () =>
    Effect.gen(function* () {
      const { fake } = platform({ syncPublicHttpRouting: () => refusal("nothingToSync") });
      const receipt = yield* addressWritesExecutor(fake).publishDomains("r1", {
        kind: "publish-domains",
        orgId: ORG,
        projectId: PROJECT,
      });
      expect(receipt).toMatchObject({
        acceptance: { kind: "accepted" },
        outcome: { kind: "pending" },
        handles: [],
      });
    }),
  );

  it.effect(
    "a change Zerops took but would not put live waits there, putting it live the person's next step",
    () =>
      Effect.gen(function* () {
        const { fake } = platform({ syncPublicPortRouting: () => refusal("projectNotActive") });
        const answer = yield* addressWritesExecutor(fake).openPort("r1", {
          kind: "open-port",
          orgId: ORG,
          projectId: PROJECT,
          ...PORT,
        });
        expect(answer).toMatchObject({
          unobservable: {
            nextActor: "person",
            nextAction: "Put the waiting change live",
            reason: "Zerops said projectNotActive.",
          },
          receipt: { acceptance: { kind: "accepted" }, outcome: { kind: "pending" }, handles: [] },
        });
      }),
  );

  it.effect("waiting changes Zerops will not put live are refused as Zerops said", () =>
    Effect.gen(function* () {
      const { fake } = platform({ syncPublicHttpRouting: () => refusal("projectNotActive") });
      const answer = yield* Effect.result(
        addressWritesExecutor(fake).publishDomains("r1", {
          kind: "publish-domains",
          orgId: ORG,
          projectId: PROJECT,
        }),
      );
      expect(Result.isFailure(answer) && answer.failure).toMatchObject({
        code: "projectNotActive",
      });
    }),
  );

  it.effect("a domain Zerops refuses is never followed by a sync, and keeps what Zerops said", () =>
    Effect.gen(function* () {
      const { fake, verbs } = platform({
        createPublicHttpRouting: () =>
          refusal("publicHttpRoutingDuplicateDomainNameInAnotherRouting"),
      });
      const answer = yield* Effect.result(
        addressWritesExecutor(fake).addDomain("r1", {
          kind: "add-domain",
          orgId: ORG,
          projectId: PROJECT,
          domains: ["shop.com"],
          serviceId: "s1",
          port: 3000,
        }),
      );
      expect(verbs()).toEqual(["createPublicHttpRouting"]);
      expect(Result.isFailure(answer) && answer.failure).toMatchObject({
        code: "publicHttpRoutingDuplicateDomainNameInAnotherRouting",
      });
    }),
  );

  it.effect("removing one of a routing's domains keeps the others on it", () =>
    Effect.gen(function* () {
      const { fake, calls, verbs } = platform();
      yield* addressWritesExecutor(fake).removeDomain("r1", {
        kind: "remove-domain",
        orgId: ORG,
        projectId: PROJECT,
        routingId: "rt1",
        domainName: "www.shop.com",
        keep: ["shop.com"],
        locations: [{ path: "/", port: 3000, serviceStackId: "s1" }],
        sslEnabled: true,
      });
      expect(verbs()).toEqual(["updatePublicHttpRouting", "syncPublicHttpRouting"]);
      expect(calls[0]?.args).toEqual([
        "rt1",
        {
          domains: ["shop.com"],
          locations: [{ path: "/", port: 3000, serviceStackId: "s1" }],
          sslEnabled: true,
        },
      ]);
    }),
  );

  it.effect("removing a routing's last domain removes the routing", () =>
    Effect.gen(function* () {
      const { fake, verbs } = platform();
      yield* addressWritesExecutor(fake).removeDomain("r1", {
        kind: "remove-domain",
        orgId: ORG,
        projectId: PROJECT,
        routingId: "rt1",
        domainName: "shop.com",
        keep: [],
        locations: [{ path: "/", port: 3000, serviceStackId: "s1" }],
        sslEnabled: true,
      });
      expect(verbs()).toEqual(["deletePublicHttpRouting", "syncPublicHttpRouting"]);
    }),
  );

  it.effect(
    "opening a port sends where it opens and who may connect, then the project's ports",
    () =>
      Effect.gen(function* () {
        const { fake, calls, verbs } = platform();
        yield* addressWritesExecutor(fake).openPort("r1", {
          kind: "open-port",
          orgId: ORG,
          projectId: PROJECT,
          ...PORT,
        });
        expect(verbs()).toEqual(["createPublicPortRouting", "syncPublicPortRouting"]);
        const { serviceId, ...sent } = PORT;
        expect(calls[0]?.args).toEqual([serviceId, sent]);
      }),
  );

  it.effect("a sync whose answer is lost leaves the write uncertain, never repeated", () =>
    Effect.gen(function* () {
      const { fake, verbs } = platform({
        syncPublicPortRouting: () => Promise.reject(new ZeropsApiError("socket closed", "network")),
      });
      const answer = yield* Effect.result(
        addressWritesExecutor(fake).closePort("r1", {
          kind: "close-port",
          orgId: ORG,
          projectId: PROJECT,
          portRoutingId: "pr1",
        }),
      );
      expect(verbs()).toEqual(["deletePublicPortRouting", "syncPublicPortRouting"]);
      expect(Result.isFailure(answer) && answer.failure).toMatchObject({
        outcome: "uncertain-acceptance",
      });
    }),
  );

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
