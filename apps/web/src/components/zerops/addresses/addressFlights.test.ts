import type { OperationEnd, OperationProgress } from "@t3tools/client-runtime/data";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import type { AddressWrite } from "./addresses.logic";
import { placeKeyOf, runAddressWrite, useAddressFlights, type WriteOwner } from "./addressFlights";

const PLACE = { orgId: "org", projectId: "p1" };
const KEY = placeKeyOf(PLACE);
const ADD: AddressWrite = {
  kind: "add-domain",
  projectId: "p1",
  domains: ["shop.com"],
  serviceId: "svc-app",
  port: 3000,
};
const BUY: AddressWrite = { kind: "request-ipv4", projectId: "p1" };

/** An owner that answers `progress` at once and ends the operation with `end`. */
function owner(progress: OperationProgress, end: NonNullable<OperationEnd>): WriteOwner {
  return {
    submit: async () => ({ requestId: "r1", progress, evidence: null }),
    untilEnd: async () => end,
  };
}

const placeState = () => useAddressFlights.getState().byPlace[KEY];

beforeEach(() => {
  useAddressFlights.setState({ byPlace: {} });
});

describe("a place's writes", () => {
  it("a refused write says why in a sentence, naming the domain", async () => {
    const run = runAddressWrite(
      owner(
        {
          stage: "refused",
          reason: "Duplicate.",
          code: "publicHttpRoutingDuplicateDomainNameInAnotherRouting",
        },
        { stage: "unobserved" },
      ),
      PLACE,
      ADD,
    );
    expect(placeState()?.flights["add-domain"]).toEqual(ADD);
    const { taken } = await run;
    expect(taken).toBe(false);
    expect(placeState()?.trouble["add-domain"]).toBe("shop.com is already in use on Zerops.");
    expect(placeState()?.flights["add-domain"]).toBeUndefined();
  });

  it("a write that fails after the person moved to another place keeps its reason for its own place", async () => {
    const { taken, ended } = await runAddressWrite(
      owner(
        { stage: "accepted", operationId: "op" },
        {
          stage: "done",
          operationId: "op",
          outcome: "failed",
          reason: "Zerops couldn't put the domain in place.",
        },
      ),
      PLACE,
      ADD,
    );
    expect(taken).toBe(true);
    await ended;
    expect(placeState()?.trouble["add-domain"]).toBe("Zerops couldn't put the domain in place.");
    expect(
      useAddressFlights.getState().byPlace[placeKeyOf({ orgId: "org", projectId: "p2" })],
    ).toBeUndefined();
  });

  it("a purchase whose answer was lost is kept as one that may have landed", async () => {
    const { taken, ended } = await runAddressWrite(
      owner(
        { stage: "uncertain", next: "asking-owner" },
        { stage: "uncertain", next: "ask-owner-again" },
      ),
      PLACE,
      BUY,
    );
    expect(taken).toBe(true);
    await ended;
    expect(placeState()?.flights["request-ipv4"]).toBeUndefined();
    expect(placeState()?.unsure["request-ipv4"]).toBe(true);
    expect(placeState()?.trouble["request-ipv4"]).toContain("may have accepted");
  });

  it("the same control takes no second press while its write is under way", async () => {
    let answer: (value: Awaited<ReturnType<WriteOwner["submit"]>>) => void = () => {};
    const slow: WriteOwner = {
      submit: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
      untilEnd: async () => ({ stage: "unobserved" }),
    };
    const first = runAddressWrite(slow, PLACE, ADD);
    const second = await runAddressWrite(slow, PLACE, ADD);
    expect(second.taken).toBe(false);
    answer({ requestId: "r1", progress: { stage: "accepted", operationId: "op" }, evidence: null });
    expect((await first).taken).toBe(true);
  });
});
