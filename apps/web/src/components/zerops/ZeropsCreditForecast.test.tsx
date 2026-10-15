/**
 * The create dialogs' forecast of the credit wall: Zerops makes a new organization's first project
 * free and refuses any after it until its first top-up. Before Create, the dialog says so where the
 * organization's record and its projects say it, with HQ to add credit — and nothing while either
 * is unread or failed.
 */
import { RegistryContext } from "@effect/atom-react";
import { accountReadsAtom, creditScope, type AccountStore } from "@t3tools/client-runtime/data";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import { AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ZeropsCreditForecast } from "./ZeropsCreditForecast";

const ORG = "org-acme";
const SCOPE = creditScope(ORG);

let registry = AtomRegistry.make();
let store: AccountStore;
let held: string[] = [];
let tree: ReactTestRenderer | undefined;

/** The account's store, its projects listed: HQ's, the organization's free one, or none. */
function account(projects: ReadonlyArray<string>) {
  registry = AtomRegistry.make();
  held = [];
  store = mountRoster(
    registry,
    ORG,
    projects.map((id) => ({ id, name: id, status: "ACTIVE" })),
  );
  registry.set(accountReadsAtom, {
    data: store.data,
    orgId: ORG,
    demandDetail: ({ family, ownerId }) => {
      const demand = `${family}:${ownerId}`;
      held.push(demand);
      return () => void held.splice(held.indexOf(demand), 1);
    },
    renewHeld: () => {},
  });
}

const stream = (event: object) =>
  store.dispatch({ kind: "stream", key: SCOPE, now: 0, event } as Parameters<
    AccountStore["dispatch"]
  >[0]);

/** The organization's record read: whether a top-up verified it. */
function creditRead(verified: boolean) {
  stream({ kind: "demand", demanded: true });
  stream({ kind: "attempt" });
  stream({ kind: "handshake" });
  store.dispatch({ kind: "baseline-begin", scope: SCOPE, generation: 1 });
  store.dispatch({
    kind: "baseline-commit",
    scope: SCOPE,
    generation: 1,
    via: "zerops-read",
    members: [ORG],
    rows: [
      {
        family: "organizationCredit",
        id: ORG,
        value: { verified },
        revision: { kind: "zerops", version: null },
      },
    ],
  });
  stream({ kind: "baseline-committed" });
}

function show() {
  act(() => {
    tree = create(
      <RegistryContext.Provider value={registry}>
        <ZeropsCreditForecast organizationId={ORG} />
      </RegistryContext.Provider>,
    );
  });
}

type Node = ReturnType<ReactTestRenderer["toJSON"]>;
/** What a node says, its links' words in place. */
const text = (node: Node | string): string =>
  node === null
    ? ""
    : typeof node === "string"
      ? node
      : Array.isArray(node)
        ? node.map(text).join("")
        : (node.children ?? []).map(text).join("");
const said = () => text(tree?.toJSON() ?? null);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

describe("the create dialog's word on credit", () => {
  it("the dialog says nothing about credit while it is unknown", () => {
    account(["hq"]);
    show();
    expect(tree?.toJSON()).toBeNull();
  });

  it("the dialog says nothing about credit where its read failed", () => {
    account(["hq"]);
    stream({ kind: "demand", demanded: true });
    stream({ kind: "attempt" });
    stream({ kind: "fault", jitter: 0, fault: { outcome: "transient", message: "lost" } });
    show();
    expect(tree?.toJSON()).toBeNull();
  });

  it("forecasts that an organization no top-up verified needs credit for another project, with HQ to add it", () => {
    account(["hq"]);
    creditRead(false);
    show();
    expect(said()).toBe(
      "Zerops needs credit on this organization before it makes another project. Add credit in HQ",
    );
    const link = tree!.root.findByType("a");
    expect(link.props.href).toBe(`https://hq.zerops.io/organizations/${ORG}`);
    expect(link.props.target).toBe("_blank");
  });

  it("says nothing about credit for an organization a top-up verified", () => {
    account(["hq"]);
    creditRead(true);
    show();
    expect(tree?.toJSON()).toBeNull();
  });

  it("says nothing about credit to an organization making its free project", () => {
    account([]);
    creditRead(false);
    show();
    expect(tree?.toJSON()).toBeNull();
  });

  it("reads the organization's credit while the dialog is open, and lets it go when it closes", () => {
    account(["hq"]);
    show();
    expect(held).toEqual([`organizationCredit:${ORG}`]);
    act(() => tree?.unmount());
    tree = undefined;
    expect(held).toEqual([]);
  });
});
