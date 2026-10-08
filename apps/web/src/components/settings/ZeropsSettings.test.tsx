import { beforeEach, expect, it, vi } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import {
  autoUpdatePolicySettings,
  autoUpdatePolicyScope,
  makeAccountStore,
  readsOfState,
} from "@t3tools/client-runtime/data";
import type { ReactElement } from "react";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { visitElements } from "../../test/reactElementTree";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: hooks.useState,
}));
vi.mock("react/compiler-runtime", () => ({ c: hooks.useMemoCache }));
const fixture = vi.hoisted(() => ({
  role: "ADMIN",
  policy: {} as import("@t3tools/client-runtime/data").AutoUpdatePolicySettings,
  submit: vi.fn(),
  again: vi.fn(),
}));
vi.mock("~/zerops/ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    activeOrganization: { id: "org", roleCode: fixture.role, name: "Test", membershipId: "member" },
    organizations: [],
    status: "signed-out",
    organizationStatus: "selected",
    user: null,
  }),
}));
vi.mock("~/zerops/useAutoUpdatePolicy", () => ({
  useAutoUpdatePolicy: () => ({ policy: fixture.policy, again: fixture.again }),
}));
vi.mock("~/zerops/accountOperations", () => ({
  useAccountOperations: () => ({ submit: fixture.submit }),
}));
import { ZeropsSettings } from "./ZeropsSettings";

let store: ReturnType<typeof makeAccountStore>;
function render() {
  fixture.policy = autoUpdatePolicySettings.derive(readsOfState(store.state()), {
    orgId: "org",
    admin: fixture.role === "ADMIN",
  });
  hooks.beginRender();
  return ZeropsSettings();
}
function control(tree: unknown) {
  return visitElements(
    tree,
    (element) => element.props["aria-label"] === "Update Mates automatically",
  );
}
function words(tree: unknown): string {
  if (typeof tree === "string") return tree;
  if (Array.isArray(tree)) return tree.map(words).join(" ");
  if (tree !== null && typeof tree === "object" && "props" in tree)
    return Object.values((tree as ReactElement<Record<string, unknown>>).props)
      .map(words)
      .join(" ");
  return "";
}
beforeEach(() => {
  hooks.reset();
  fixture.role = "ADMIN";
  fixture.submit.mockReset();
  store = makeAccountStore(AtomRegistry.make());
  const scope = autoUpdatePolicyScope("org");
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } });
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "attempt" } });
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "handshake" } });
  store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "baseline-committed" } });
});
it.each([true, false])(
  "an organization admin toggles the observed policy from %s through a receipt",
  (enabled) => {
    observePolicy(store, { orgId: "org", enabled, revision: 1 });
    const tree = render();
    const toggle = control(tree);
    if (toggle === null) throw new Error("Expected an admin toggle");
    expect(toggle.props).toMatchObject({ checked: enabled, disabled: false });
    (toggle.props.onCheckedChange as (value: boolean) => void)(!enabled);
    expect(fixture.submit).toHaveBeenCalledWith(
      { kind: "set-auto-update-policy", orgId: "org", enabled: !enabled },
      "auto-update-policy/org/1",
    );
    expect(words(tree)).toContain(
      "Updates only when a Mate is idle; rolls back if the new version fails.",
    );
  },
);
it.each([true, false])("a non-admin reads %s and sees who may change it", (enabled) => {
  fixture.role = "READ_ONLY";
  observePolicy(store, { orgId: "org", enabled, revision: 1 });
  const tree = render();
  expect(control(tree)).toBeNull();
  expect(words(tree)).toContain(enabled ? "On" : "Off");
  expect(words(tree)).toContain("Organization admins and the owner can change this.");
});
it("does not invent an enabled state before HQ answers", () => {
  expect(control(render())).toBeNull();
  expect(words(render())).toContain("Waiting for HQ…");
});
it("keeps the observed state while saving and explains HQ's refusal", () => {
  observePolicy(store, { orgId: "org", enabled: true, revision: 1 });
  store.dispatch({
    kind: "operation-recorded",
    requestId: "auto-update-policy/org/1",
    intent: { kind: "set-auto-update-policy", orgId: "org", enabled: false },
  });
  expect(control(render())?.props).toMatchObject({ checked: true, disabled: true });
  expect(words(render())).toContain("Saving…");
  store.dispatch({
    kind: "operation-receipt",
    receipt: {
      requestId: "auto-update-policy/org/1",
      operationId: "org",
      executor: "hq",
      affected: [],
      handles: [],
      acceptance: { kind: "refused", reason: "Your organization admin permission was removed." },
      outcome: { kind: "pending" },
    },
  });
  const tree = render();
  expect(words(tree)).toContain("Your organization admin permission was removed.");
  expect(control(tree)?.props.checked).toBe(true);
});
it.each(["uncertain", "unresolved"] as const)(
  "offers a new change after remount while preserving the %s receipt",
  (stage) => {
    observePolicy(store, { orgId: "org", enabled: false, revision: 1 });
    store.dispatch({
      kind: "operation-recorded",
      requestId: "auto-update-policy/org/1",
      intent: { kind: "set-auto-update-policy", orgId: "org", enabled: false },
    });
    store.dispatch({
      kind: "operation-uncertain",
      requestId: "auto-update-policy/org/1",
      reason: "Answer lost",
    });
    if (stage === "unresolved")
      store.dispatch({
        kind: "operation-exhausted",
        requestId: "auto-update-policy/org/1",
        unobservable: { nextActor: "organization admin", reason: "Answer lost" },
      });
    const earlier = store.state().operations.get("auto-update-policy/org/1");
    hooks.reset();
    expect(control(render())?.props.disabled).toBe(true);
    const tree = render();
    expect(words(tree)).toContain("HQ could not confirm this change.");
    expect(words(tree)).toContain("Current policy: Off");
    const recovery = visitElements(
      tree,
      (element) =>
        typeof element.props.onClick === "function" &&
        words(element.props.children).includes("Send new change:"),
    );
    if (recovery === null) throw new Error("Expected an explicit recovery action");
    (recovery.props.onClick as () => void)();
    expect(fixture.submit).toHaveBeenCalledWith(
      { kind: "set-auto-update-policy", orgId: "org", enabled: true },
      "auto-update-policy/org/2",
    );
    expect(store.state().operations.get("auto-update-policy/org/1")).toEqual(earlier);
  },
);

it.each(["none", "unreadable"] as const)(
  "explains %s HQ instead of waiting forever or inventing a policy",
  (verdict) => {
    store.dispatch({
      kind: "rows",
      scope: "zerops:org:hq-verdict",
      generation: 0,
      method: "read",
      via: "zerops-realtime",
      rows: [
        {
          family: "hqVerdict",
          id: "org",
          value: { verdict },
          revision: { kind: "zerops", version: null },
        },
      ],
    });
    const tree = render();
    expect(control(tree)).toBeNull();
    expect(words(tree)).toContain(
      verdict === "none"
        ? "Set up HQ to read this policy."
        : "HQ is unavailable; check its connection.",
    );
  },
);

function observePolicy(
  store: ReturnType<typeof makeAccountStore>,
  policy: { orgId: string; enabled: boolean; revision: number },
  incarnation = "core",
) {
  const scope = `hq:${policy.orgId}:auto-update-policy` as const;
  store.dispatch({
    kind: "rows",
    scope,
    generation: readsOfState(store.state()).stream(scope).generation,
    method: "read",
    via: "hq-stream",
    rows: [
      {
        family: "hqAutoUpdatePolicy",
        id: policy.orgId,
        value: { epoch: "core", ...policy },
        revision: { kind: "hq", incarnation, revision: policy.revision },
      },
    ],
  });
}

it.each(["receipt-first", "stream-first"])(
  "a confirmed toggle shows the accepted policy in %s order",
  (order) => {
    observePolicy(store, { orgId: "org", enabled: false, revision: 1 });
    store.dispatch({
      kind: "operation-recorded",
      requestId: "auto-update-policy/org/1",
      intent: { kind: "set-auto-update-policy", orgId: "org", enabled: true },
    });
    const answer = () =>
      store.dispatch({
        kind: "operation-receipt",
        receipt: {
          requestId: "auto-update-policy/org/1",
          operationId: "org",
          executor: "hq",
          affected: [],
          handles: [],
          acceptance: {
            kind: "accepted",
            result: { policy: { orgId: "org", enabled: true, revision: 2, epoch: "core" } },
          },
          outcome: { kind: "succeeded", evidence: "HQ answered" },
        },
      });
    const observe = () => observePolicy(store, { orgId: "org", enabled: true, revision: 2 });
    if (order === "receipt-first") answer();
    else observe();
    expect(control(render())?.props).toMatchObject({
      checked: true,
      disabled: order === "stream-first",
    });
    if (order === "receipt-first") observe();
    else answer();
    const toggle = control(render());
    if (toggle === null) throw new Error("Expected a reflected admin toggle");
    expect(toggle.props).toMatchObject({ checked: true, disabled: false });
    (toggle.props.onCheckedChange as (value: boolean) => void)(false);
    expect(fixture.submit).toHaveBeenCalledWith(
      { kind: "set-auto-update-policy", orgId: "org", enabled: false },
      "auto-update-policy/org/2",
    );
  },
);

it("a completed toggle stays settled when a fresh HQ starts at revision zero", () => {
  const accepted = { orgId: "org", enabled: false, revision: 5, epoch: "old-core" };
  observePolicy(store, accepted, "old-core");
  store.dispatch({
    kind: "operation-recorded",
    requestId: "auto-update-policy/org/1",
    intent: { kind: "set-auto-update-policy", orgId: "org", enabled: false },
  });
  store.dispatch({
    kind: "operation-receipt",
    receipt: {
      requestId: "auto-update-policy/org/1",
      operationId: "org",
      executor: "hq",
      affected: [],
      handles: [],
      acceptance: { kind: "accepted", result: { policy: accepted } },
      outcome: { kind: "succeeded", evidence: "HQ confirmed revision 5" },
    },
  });
  expect(control(render())?.props.disabled).toBe(false);
  const replacement = { orgId: "org", enabled: true, revision: 0, epoch: "new-core" };
  store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    reset: true,
    scopes: [
      {
        scope: autoUpdatePolicyScope("org"),
        generation: readsOfState(store.state()).stream(autoUpdatePolicyScope("org")).generation,
      },
    ],
    rows: [
      {
        family: "hqAutoUpdatePolicy",
        id: "org",
        value: replacement,
        revision: { kind: "hq", incarnation: "new-core", revision: 0 },
      },
    ],
    removals: [],
  });
  render();
  expect(fixture.policy).toMatchObject({
    pending: false,
    editable: true,
    enabled: true,
    words: "On",
  });
});
