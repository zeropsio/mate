import { describe, expect, it } from "@effect/vitest";

import { stopServices } from "../flow/deployment.ts";
import { deployed, record, servicesRead } from "../flow/__fixtures__/services.ts";
import { processesRead } from "../flow/__fixtures__/processes.ts";
import { DEFAULT_ZEROPS_DATA_POLICY } from "./policy.ts";
import { selectServicesOf } from "./projection.ts";
import {
  makeInitialZeropsDataState,
  reduceZeropsDataState,
  type ZeropsDataState,
} from "./state.ts";
import { queryKeyOf, serviceKeyOf, type RuntimeInterestDescriptor } from "./types.ts";
import {
  desiredInterest,
  directTicket,
  identity,
  organization,
  project,
  queryTicket,
  scope,
  service,
  stamp,
} from "./__fixtures__/index.ts";

const reduce = (
  state: ReturnType<typeof makeInitialZeropsDataState>,
  input: Parameters<typeof reduceZeropsDataState>[1],
) => reduceZeropsDataState(state, input, DEFAULT_ZEROPS_DATA_POLICY).state;

describe("Zerops data projections", () => {
  it.each(["failure-first", "deploy-first"] as const)(
    "a new pushed deploy settles despite a metadata read failure (%s)",
    (order) => {
      const runtime = desiredInterest(identity(1, 1, 1, "runtime"));
      const metadata = desiredInterest(identity(1, 1, 1, "versions"));
      let state: ZeropsDataState = {
        ...makeInitialZeropsDataState(scope()),
        interests: new Map([
          [
            runtime.key,
            {
              ...runtime,
              interest: {
                status: "observing" as const,
                identity: runtime.interest.identity,
                guarantee: "source-order-unverified" as const,
                sinceReceiptOrdinal: stamp(1).receiptOrdinal,
              },
            },
          ],
          [
            metadata.key,
            {
              ...metadata,
              descriptor: {
                kind: "project-versions" as const,
                project: project(),
                serviceIds: ["app"],
              },
            },
          ],
        ]),
      };
      const facet = deployed({
        id: "version-new",
        status: "ACTIVE",
        source: "GIT",
        name: "main a8512b0",
        activatedAt: "2026-10-04T07:38:18Z",
        branch: "main",
        commit: "a8512b0",
        tag: null,
        repository: "app",
      });
      if (facet.knowledge !== "observed") throw new Error("The deploy fixture must be observed.");
      const pushed = record("app", "app", { ...facet, source: "native-push" });
      const fail = () => {
        state = {
          ...state,
          interests: new Map(state.interests).set(metadata.key, {
            ...metadata,
            descriptor: { kind: "project-versions", project: project(), serviceIds: ["app"] },
            interest: {
              status: "failed",
              identity: metadata.interest.identity,
              reason: "timeout",
              attempts: 1,
              retryable: true,
              retryAtMs: null,
            },
          }),
        };
      };
      const deploy = () => {
        state = {
          ...state,
          inventory: {
            ...state.inventory,
            services: new Map([[serviceKeyOf(pushed.ref), pushed]]),
          },
        };
      };
      const read = () =>
        stopServices(
          {
            services: {
              ...servicesRead([pushed]),
              ...selectServicesOf(state, project()),
              query: servicesRead([pushed]).query,
            },
            processes: processesRead([]),
            names: new Map(),
            stated: new Map(),
            refused: null,
          },
          10_000,
        );
      if (order === "failure-first") {
        fail();
        deploy();
      } else {
        deploy();
        read();
        fail();
      }
      const stop = read();
      expect(stop).toMatchObject({
        state: "known",
        freshness: { kind: "live" },
        value: [
          {
            deployment: {
              state: "known",
              freshness: { kind: "live" },
              value: { kind: "running", version: { commit: "a8512b0" } },
            },
          },
        ],
      });
    },
  );

  it.each([
    { kind: "project-versions", project: project(), serviceIds: ["app"] },
    { kind: "project-variables", project: project(), serviceIds: ["app"] },
    { kind: "project-current-metrics", project: project() },
    { kind: "organization-inventory", organization },
  ] satisfies ReadonlyArray<RuntimeInterestDescriptor>)(
    "a failed $kind read cannot fail the runtime listings after a deploy",
    (descriptor) => {
      const runtime = desiredInterest(identity(1, 1, 1, "runtime"));
      const unrelated = desiredInterest(identity(1, 1, 1, "unrelated"));
      const state = {
        ...makeInitialZeropsDataState(scope()),
        interests: new Map([
          [runtime.key, runtime],
          [
            unrelated.key,
            {
              ...unrelated,
              descriptor,
              interest: {
                status: "failed" as const,
                identity: unrelated.interest.identity,
                reason: "timeout",
                attempts: 1,
                retryable: true,
                retryAtMs: null,
              },
            },
          ],
        ]),
      };
      expect(selectServicesOf(state, project()).observation.required).toEqual([runtime.interest]);
    },
  );

  it("project-inventory supplies its project's service listing", () => {
    const desired = desiredInterest();
    const state = {
      ...makeInitialZeropsDataState(scope()),
      interests: new Map([
        [
          desired.key,
          { ...desired, descriptor: { kind: "project-inventory" as const, project: project() } },
        ],
      ]),
    };
    expect(selectServicesOf(state, project()).observation.required).toEqual([desired.interest]);
  });

  it("preserves the exact unresolved member ref and uses a scoped query identity", () => {
    const id = identity();
    const owner = project();
    const ref = service("unresolved", owner);
    const descriptor = {
      kind: "services-of-project" as const,
      project: owner,
      schemaVersion: 1 as const,
    };
    const ticket = queryTicket(descriptor, id);
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(1),
        accessEvidence: null,
        input: {
          kind: "query-baseline-observed",
          members: [ref],
          unresolvedMembers: [ref],
          observedTotal: 1,
          coverage: {
            kind: "exhausted-traversal",
            traversedPages: 1,
            observedTotal: 1,
            guarantee: "non-atomic",
          },
          source: "direct-read",
          ticket,
        },
      },
    });
    const view = selectServicesOf(state, owner);
    expect(view.query.key).toBe(queryKeyOf(descriptor));
    expect(view.value).toEqual([{ knowledge: "unresolved", ref }]);
    expect(view.value[0]?.knowledge === "unresolved" ? view.value[0].ref.serviceId : null).toBe(
      ref.serviceId,
    );
  });

  it("derives project services from canonical relationships beyond indexed membership", () => {
    const id = identity();
    const owner = project();
    const ref = service("direct-only", owner);
    const ticket = directTicket({ kind: "service", ref }, id);
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(1),
        accessEvidence: null,
        input: {
          kind: "service-identity-observed",
          ref,
          observation: { source: "direct-read", ticket, fields: { hostname: "api" }, metadata: {} },
        },
      },
    });
    expect(state.inventory.services.has(serviceKeyOf(ref))).toBe(true);
    expect(
      selectServicesOf(state, owner).value.map((entry) =>
        entry.knowledge === "observed" ? entry.record.ref : entry.ref,
      ),
    ).toEqual([ref]);
  });

  it("leaves unopened projects unresolved when one project has a service baseline", () => {
    const id = identity();
    const [one, two, empty] = [project("one"), project("two"), project("empty")];
    const members = [service("one-api", one), service("one-db", one), service("two-api", two)];
    const descriptor = {
      kind: "services-of-project" as const,
      project: one,
      schemaVersion: 1 as const,
    };
    let state = reduce(makeInitialZeropsDataState(scope()), {
      kind: "interest-upserted",
      interest: desiredInterest(id),
    });
    state = reduce(state, {
      kind: "observation",
      observation: {
        stamp: stamp(1),
        accessEvidence: null,
        input: {
          kind: "query-baseline-observed",
          members,
          unresolvedMembers: members,
          observedTotal: members.length,
          coverage: {
            kind: "exhausted-traversal",
            traversedPages: 1,
            observedTotal: members.length,
            guarantee: "non-atomic",
          },
          source: "indexed-search",
          ticket: queryTicket(descriptor, id),
        },
      },
    });
    const slice = (ref: ReturnType<typeof project>) => {
      const read = selectServicesOf(state, ref);
      return {
        status: read.query.status,
        services: read.value.map((entry) =>
          entry.knowledge === "observed" ? entry.record.ref.serviceId : entry.ref.serviceId,
        ),
      };
    };

    expect([one, two, empty].map(slice)).toEqual([
      { status: "observed", services: ["one-api", "one-db"] },
      { status: "unresolved", services: ["two-api"] },
      { status: "unresolved", services: [] },
    ]);
  });
});
