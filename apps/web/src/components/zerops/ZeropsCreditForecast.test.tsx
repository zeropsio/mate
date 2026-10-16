/**
 * The create dialogs' forecast of the credit wall: Zerops makes a new organization's first project
 * free and refuses any after it while the organization is unverified and holds no credit, promo
 * credit included. Before Create, the dialog says so where the organization's record, its balance
 * and its projects say it, with HQ to add credit — and nothing while any is unread or failed.
 */
import { RegistryContext } from "@effect/atom-react";
import {
  accountReadsAtom,
  balanceScope,
  creditScope,
  type AccountStore,
} from "@t3tools/client-runtime/data";

type AccountRow = Extract<
  Parameters<AccountStore["dispatch"]>[0],
  { kind: "baseline-commit" }
>["rows"][number];
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import { AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ZeropsCreditForecast } from "./ZeropsCreditForecast";

const billing = vi.hoisted(() => ({ addCredit: true }));
vi.mock("~/zerops/usePlatformCapabilities", () => ({
  useCreditOffers: () => ({ addCredit: billing.addCredit }),
}));

const ORG = "org-acme";
const SCOPE = creditScope(ORG);
const BALANCE = balanceScope(ORG);

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

const stream = (event: object, key = SCOPE) =>
  store.dispatch({ kind: "stream", key, now: 0, event } as Parameters<AccountStore["dispatch"]>[0]);

/** One read of the organization's own `scope` answering `family`'s `value`. */
function read(scope: typeof SCOPE, row: Pick<AccountRow, "family" | "value">) {
  stream({ kind: "demand", demanded: true }, scope);
  stream({ kind: "attempt" }, scope);
  stream({ kind: "handshake" }, scope);
  store.dispatch({ kind: "baseline-begin", scope, generation: 1 });
  store.dispatch({
    kind: "baseline-commit",
    scope,
    generation: 1,
    via: "zerops-read",
    members: [ORG],
    rows: [{ ...row, id: ORG, revision: { kind: "zerops", version: null } } as AccountRow],
  });
  stream({ kind: "baseline-committed" }, scope);
}

/** The organization's record read, whether a top-up verified it, beside its balance: none. */
function creditRead(verified: boolean, promoCredit = 0) {
  read(SCOPE, { family: "organizationCredit", value: { verified } });
  read(BALANCE, { family: "organizationBalance", value: { credit: 0, promoCredit } });
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
  billing.addCredit = true;
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
    show();
    act(() => creditRead(false));
    expect(said()).toBe(
      "Zerops needs credit on this organization before it makes another project. Add credit in HQ",
    );
    const link = tree!.root.findByType("a");
    expect(link.props.href).toBe(`https://hq.zerops.io/organizations/${ORG}`);
    expect(link.props.target).toBe("_blank");
  });

  it("asks a member who may not edit the organization's finances to have an owner add credit, with no way to HQ", () => {
    account(["hq"]);
    billing.addCredit = false;
    show();
    act(() => creditRead(false));
    expect(said()).toBe(
      "Zerops needs credit on this organization before it makes another project. Ask an owner to add credit.",
    );
    expect(tree!.root.findAllByType("a")).toHaveLength(0);
  });

  it("says nothing on reopening from the record read before the dialog opened, only from its own read", () => {
    account(["hq"]);
    creditRead(false);
    stream({ kind: "demand", demanded: false });
    show();
    expect(tree?.toJSON()).toBeNull();
  });

  it("says nothing about credit to an unverified organization holding promo credit", () => {
    account(["hq"]);
    show();
    act(() => creditRead(false, 25));
    expect(tree?.toJSON()).toBeNull();
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
    expect(held).toEqual([`organizationCredit:${ORG}`, `organizationBalance:${ORG}`]);
    act(() => tree?.unmount());
    tree = undefined;
    expect(held).toEqual([]);
  });
});
