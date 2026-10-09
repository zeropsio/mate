import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { makeAccountStore, operationProgress, readsOfState } from "@t3tools/client-runtime/data";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { AccountDataContext, type AccountData } from "./accountData";
import { AccountOperationsContext, type AccountOperations } from "./accountOperations";
import { useMateRecoveryAction } from "./useMateRecoveryAction";
import { RestartMateConfirmation } from "./RestartMateConfirmation";
import { useRestartMate } from "./mateRestart";
import { MateRestartError } from "./mateRestartRefusal";
import { ZeropsRestartMateDialog } from "../components/zerops/ZeropsRestartMateDialog";
import { RecoveryOutcomeStatus } from "./recoveryOutcomes";
type OperationReceipt = Extract<
  Parameters<ReturnType<typeof makeAccountStore>["dispatch"]>[0],
  { kind: "operation-receipt" }
>["receipt"];

const candidate = vi.hoisted(() => ({
  key: "org/p/s",
  project: { id: "p", clientId: "org", name: "Wren", status: "ACTIVE" },
  service: { id: "s", status: "STOPPED" },
}));
vi.mock("./useZeropsCandidates", () => ({ useHeldZeropsCandidates: () => [candidate] }));
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () => ({
    activeOrganization: { id: "org", membershipId: "viewer", roleCode: "OWNER" },
  }),
}));
vi.mock("./zeropsContainers", () => ({
  readContainerInitAt: async () => undefined,
  intendContainer: () => {},
}));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: () => {} } }));

vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock("../components/ui/dialog", () => {
  const Box = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Box,
    DialogPopup: Box,
    DialogHeader: Box,
    DialogTitle: Box,
    DialogDescription: Box,
    DialogFooter: Box,
    DialogPanel: Box,
  };
});

let mounted: ReactTestRenderer | undefined;
let dispose: (() => void) | undefined;
afterEach(() => {
  act(() => mounted?.unmount());
  mounted = undefined;
  dispose?.();
  dispose = undefined;
  candidate.project.status = "ACTIVE";
});

const branches = [
  { action: "restart", stopped: false, kind: "mate-restart" },
  { action: "start", stopped: false, kind: "start-service" },
  { action: "start", stopped: true, kind: "start-project" },
] as const;

function fixture(mode: "lost" | "accepted" | "refused" = "lost", form = false) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const calls: string[] = [];
  const requestIds: string[] = [];
  const unused = () => {
    throw new Error("Unused operation");
  };
  const receipt = (requestId: string, outcome: OperationReceipt["outcome"], refused = false) =>
    store.dispatch({
      kind: "operation-receipt",
      receipt: {
        requestId,
        operationId: requestId,
        executor: "zerops",
        affected: [],
        handles: [requestId + "-process"],
        acceptance: refused
          ? { kind: "refused", reason: "Project access could not be verified." }
          : { kind: "accepted" },
        outcome,
      },
    });
  const operations: AccountOperations = {
    submit: async (intent, requestId = `request-${calls.length}`) => {
      calls.push(`send:${intent.kind}:${requestId}`);
      requestIds.push(requestId);
      store.dispatch({ kind: "operation-recorded", requestId, intent });
      if (mode === "lost") {
        store.dispatch({ kind: "operation-uncertain", requestId });
        store.dispatch({ kind: "operation-lookup-failed", requestId });
      } else receipt(requestId, { kind: "pending" }, mode === "refused");
      return {
        requestId,
        progress: operationProgress.derive(readsOfState(store.state()), requestId),
        evidence: null,
      };
    },
    askAgain: async (id) => {
      calls.push(`ask:${id}`);
    },
    readProgress: (id) => operationProgress.derive(readsOfState(store.state()), id),
    untilEnd: unused,
    run: unused,
    untilMoveRemainder: unused,
    untilEnvironment: unused,
    readCreation: unused,
  };
  let recovery: ReturnType<typeof useMateRecoveryAction>;
  function Origin() {
    recovery = useMateRecoveryAction("p");
    return <section aria-label="Recovery origin">{recovery.feedback}</section>;
  }
  function Form() {
    const restart = useRestartMate();
    return (
      <RestartMateConfirmation
        name="Wren"
        projectId="p"
        environmentId={undefined}
        pending={false}
        error={null}
        onCancel={() => {}}
        onConfirm={async () => {
          try {
            await restart({ key: "p:s", projectId: "p", serviceId: "s", status: "STOPPED" });
          } catch (cause) {
            if (!(cause instanceof MateRestartError)) throw cause;
          }
        }}
      />
    );
  }
  const tree = (origin: boolean) => (
    <RegistryContext.Provider value={registry}>
      <AccountDataContext.Provider value={{ data: store.data, orgId: "org" } as AccountData}>
        <AccountOperationsContext.Provider value={operations}>
          {origin ? form ? <Form /> : <Origin /> : null}
          <RecoveryOutcomeStatus />
        </AccountOperationsContext.Provider>
      </AccountDataContext.Provider>
    </RegistryContext.Provider>
  );
  const show = (origin: boolean) =>
    act(() => {
      if (mounted === undefined) mounted = create(tree(origin));
      else mounted.update(tree(origin));
    });
  dispose = () => {
    store.close();
    registry.dispose();
  };
  const press = async (action: "start" | "restart") =>
    act(async () => {
      await recovery!.act!(action);
    });
  const shell = () =>
    JSON.stringify(
      mounted!.root
        .findByProps({ "aria-label": "Recovery results" })
        .findAllByProps({ role: "status" })
        .map((node) => node.findByType("span").children),
    );
  return {
    store,
    get: () => recovery!,
    confirm: () =>
      act(async () => {
        await mounted!.root.findByType(ZeropsRestartMateDialog).props.onConfirm();
      }),
    show,
    press,
    calls,
    requestIds,
    receipt,
    shell,
    mode: (next: typeof mode) => {
      mode = next;
    },
  };
}

it.each(branches)(
  "reopening recovery after a lost $kind response checks the original request without another write",
  async ({ action, stopped, kind }) => {
    if (stopped) candidate.project.status = "STOPPED";
    const f = fixture();
    f.show(true);
    await f.press(action);
    f.show(false);
    expect(f.shell()).toContain("unconfirmed");
    expect(f.shell()).toContain("Zerops may have accepted the request.");
    f.show(true);
    expect(f.shell()).toBe("[]");
    await f.press(action);
    const id = f.requestIds[0]!;
    expect(f.calls).toEqual([`send:${kind}:${id}`, `ask:${id}`]);
  },
);

it.each(branches)(
  "a $kind refusal survives closing its origin with the owner's reason",
  async ({ action, stopped }) => {
    if (stopped) candidate.project.status = "STOPPED";
    const f = fixture("refused");
    f.show(true);
    await f.press(action);
    f.show(false);
    expect(f.shell()).toContain("refused.");
    expect(f.shell()).toContain("Project access could not be verified.");
    expect(f.shell()).not.toContain("accepted");
  },
);

it.each(branches)(
  "an accepted $kind completes in the real shell while its origin is gone",
  async ({ action, stopped }) => {
    if (stopped) candidate.project.status = "STOPPED";
    const f = fixture("accepted");
    f.show(true);
    await f.press(action);
    f.show(false);
    expect(f.shell()).toContain("Its outcome is not confirmed yet.");
    await act(async () => {
      f.receipt(f.requestIds[0]!, { kind: "succeeded", evidence: "Owner confirmed completion." });
    });
    expect(f.shell()).toContain("completed.");
    expect(f.shell()).not.toContain("not confirmed");
  },
);

it.each(branches)(
  "a late older $kind result cannot replace the newer attempt's feedback",
  async ({ action, stopped }) => {
    if (stopped) candidate.project.status = "STOPPED";
    const f = fixture("refused");
    f.show(true);
    await f.press(action);
    const old = f.requestIds[0]!;
    f.mode("accepted");
    await f.press(action);
    f.show(false);
    expect(f.shell()).toContain("Its outcome is not confirmed yet.");
    await act(async () => {
      f.receipt(old, { kind: "succeeded", evidence: "Old completion." });
    });
    expect(f.shell()).toContain("Its outcome is not confirmed yet.");
    expect(f.shell()).not.toContain("Old completion");
    await act(async () => {
      f.receipt(f.requestIds[1]!, { kind: "failed", evidence: "Newest failure." });
    });
    expect(f.shell()).toContain("Newest failure.");
    expect(f.shell()).not.toContain("Old completion");
  },
);

it("an unresolved recovery preserves its next actor after the origin closes", async () => {
  const f = fixture("accepted");
  f.show(true);
  await f.press("restart");
  await act(async () => {
    f.store.dispatch({
      kind: "operation-exhausted",
      requestId: f.requestIds[0]!,
      unobservable: {
        nextActor: "person",
        nextAction: "Check the project in Zerops",
        reason: "Process history is unavailable.",
      },
    });
  });
  f.show(false);
  expect(f.shell()).toContain("outcome is unconfirmed");
  expect(f.shell()).toContain("Next: person.");
  expect(f.shell()).toContain("Check the project in Zerops");
  f.show(true);
  await f.press("restart");
  expect(f.calls).toHaveLength(1);
});

it("a rapid repeated recovery press sends only one restart", async () => {
  const f = fixture("accepted");
  f.show(true);
  await act(async () => {
    await Promise.all([f.get().act!("restart"), f.get().act!("restart")]);
  });
  expect(f.calls).toHaveLength(1);
});

it("Decision: one derivation per state; consumers never recompute it; no new domain concepts; mobile stays out (later).", async () => {
  const f = fixture("refused");
  f.show(true);
  await f.press("restart");
  const origin = mounted!.root
    .findByProps({ "aria-label": "Recovery origin" })
    .findByType("span").children;
  f.show(false);
  expect(f.shell()).toBe(JSON.stringify([origin]));
});

it("closing and reopening the restart confirmation retains uncertainty and checks the same request", async () => {
  const f = fixture("lost", true);
  f.show(true);
  await f.confirm();
  expect(mounted!.root.findByType(ZeropsRestartMateDialog).props.confirmLabel).toBe(
    "Check restart",
  );
  f.show(false);
  expect(f.shell()).toContain("Restart unconfirmed");
  f.show(true);
  expect(f.shell()).toBe("[]");
  await f.confirm();
  expect(f.calls).toEqual([`send:mate-restart:${f.requestIds[0]}`, `ask:${f.requestIds[0]}`]);
});
