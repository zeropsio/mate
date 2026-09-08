import { describe, expect, it } from "@effect/vitest";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import { createZeropsDataAtoms } from "./atoms.ts";
import { makeInitialZeropsDataState } from "./state.ts";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsServiceId,
  type AccountScope,
  type ServiceRef,
} from "./types.ts";

const scope: AccountScope = {
  account: {
    apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
    accountId: ZeropsAccountId.make("account-a"),
  },
  epoch: AccountEpoch.make(1),
};
const service: ServiceRef = {
  kind: "service",
  project: {
    kind: "project",
    organization: {
      kind: "organization",
      account: scope.account,
      organizationId: ZeropsOrganizationId.make("org-a"),
    },
    projectId: ZeropsProjectId.make("project-a"),
  },
  serviceId: ZeropsServiceId.make("service-a"),
};

describe("createZeropsDataAtoms", () => {
  it("does not publish an unrelated projection during a 10,000-state burst", () => {
    const initial = makeInitialZeropsDataState(scope);
    const root = Atom.make(initial);
    const atoms = createZeropsDataAtoms(root);
    const selected = atoms.reads.service(service);
    const registry = AtomRegistry.make();
    let publications = 0;
    const unsubscribe = registry.subscribe(selected, () => {
      publications += 1;
    });
    const first = registry.get(selected);
    publications = 0;

    for (let index = 1; index <= 10_000; index += 1) {
      registry.set(root, {
        ...initial,
        retention: { ...initial.retention, nextId: index },
      });
    }

    expect(registry.get(selected)).toBe(first);
    expect(publications).toBe(0);
    unsubscribe();
    registry.dispose();
  });

  it("returns the same family atom for structurally equal stable references", () => {
    const root = Atom.make(makeInitialZeropsDataState(scope));
    const atoms = createZeropsDataAtoms(root);
    expect(atoms.reads.service({ ...service, project: { ...service.project } })).toBe(
      atoms.reads.service(service),
    );
  });
});
