import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { makeAccountStore, projectRestarts, readRestart } from "@t3tools/client-runtime/data";
import {
  deriveZeropsThreadModel,
  type ZeropsOperation,
} from "@t3tools/client-runtime/zerops/model";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { AccountDataContext, type AccountData } from "../ZeropsAccountData";
import { AccountOperationsContext, type AccountOperations } from "../accountOperations";
import { useOperationCard, type OperationCardRegions } from "./useOperationCard";

const source = {
  id: "source",
  actionName: "stack.restart",
  status: "FAILED",
  projectId: "p",
  serviceStackIds: ["s"],
  created: "2026-10-08T10:00:00Z",
};
const observations = vi.hoisted(() => ({ available: true }));
vi.mock("./useOperationObservation.ts", () => ({
  useOperationObservation: () => ({
    state: observations.available
      ? {
          kind: "live",
          observation: {
            process: source,
            outcome: "failed",
            serviceIds: ["s"],
            processes: [],
            chips: [],
            live: true,
          },
        }
      : { kind: "off", reason: "not-found" },
    buildLog: { status: "idle", lines: [] },
    settledRead: "read",
  }),
}));
vi.mock("../useZeropsFeeds.ts", () => ({
  useZeropsTopology: () => ({
    project: { id: "p", name: "P" },
    services: [{ serviceId: "s", hostname: "Eddy", status: "ACTIVE" }],
    warnings: [],
    usageRead: true,
  }),
}));
vi.mock("../browserStreamLinks.tsx", () => ({
  useMateBrowserCallFrame: () => ({ kind: "unknown", frame: null }),
}));
vi.mock("../useNowMs.ts", () => ({ useSecondsNowMs: () => 0 }));

let mounted: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => mounted?.unmount());
  mounted = undefined;
  observations.available = true;
});

function fixture(responseMode: "lost" | "refused" | "accepted" = "lost") {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const tasks: Array<() => void> = [];
  const registry = AtomRegistry.make({
    scheduleTask: (task) => {
      tasks.push(task);
      return () => {
        const i = tasks.indexOf(task);
        if (i >= 0) tasks.splice(i, 1);
      };
    },
  });
  const store = makeAccountStore(registry);
  const account = { data: store.data, orgId: "org" } as AccountData;
  const calls: string[] = [];
  const unused = () => {
    throw new Error("Unused account operation");
  };
  const operations: AccountOperations = {
    submit: async (intent: Parameters<AccountOperations["submit"]>[0], id = "retry") => {
      calls.push(`send:${id}`);
      store.dispatch({ kind: "operation-recorded", requestId: id, intent });
      if (responseMode === "refused")
        store.dispatch({
          kind: "operation-receipt",
          receipt: {
            requestId: id,
            operationId: id,
            executor: "zerops",
            affected: [],
            handles: [],
            acceptance: { kind: "refused", reason: "Project access could not be verified." },
            outcome: { kind: "pending" },
          },
        });
      else if (responseMode === "accepted")
        store.dispatch({
          kind: "operation-receipt",
          receipt: {
            requestId: id,
            operationId: id,
            executor: "zerops",
            affected: [],
            handles: ["new-process"],
            acceptance: { kind: "accepted" },
            outcome: { kind: "pending" },
          },
        });
      else {
        store.dispatch({ kind: "operation-uncertain", requestId: id });
        store.dispatch({ kind: "operation-lookup-failed", requestId: id });
      }
      return {
        requestId: id,
        progress: { stage: "uncertain", next: "ask-owner-again" },
        evidence: null,
      };
    },
    askAgain: async (id: string) => {
      calls.push(`ask:${id}`);
    },
    readProgress: () => ({ stage: "uncertain", next: "ask-owner-again" }),
    untilEnd: unused,
    run: unused,
    untilMoveRemainder: unused,
    untilEnvironment: unused,
    readCreation: unused,
  };
  const activities = [
    {
      id: "a",
      tone: "tool",
      kind: "tool.completed",
      summary: "Tool call",
      turnId: "t",
      createdAt: source.created,
      payload: {
        toolCallId: "c",
        status: "completed",
        data: {
          toolName: "zerops_manage",
          input: { serviceHostname: "Eddy", action: "restart" },
          zerops: { toolName: "zerops_manage", resultText: JSON.stringify({ process: source }) },
        },
      },
    },
  ] as unknown as ReadonlyArray<OrchestrationThreadActivity>;
  let answer: OperationCardRegions;
  let operation: ZeropsOperation;
  function Probe() {
    const evidence = useAtomValue(
      store.data.project(projectRestarts, { orgId: "org", projectId: "p" }),
    );
    const entry = deriveZeropsThreadModel({
      activities,
      restarts: (process) => readRestart(evidence, process),
    }).entries[0]!;
    if (entry.kind !== "operation") throw new Error("Missing restart card");
    operation = entry.operation;
    answer = useOperationCard(operation, null);
    return null;
  }
  const mount = () =>
    act(() => {
      mounted = create(
        <RegistryContext.Provider value={registry}>
          <AccountDataContext.Provider value={account}>
            <AccountOperationsContext.Provider value={operations}>
              <Probe />
            </AccountOperationsContext.Provider>
          </AccountDataContext.Provider>
        </RegistryContext.Provider>,
      );
    });
  return {
    mount,
    calls,
    get: () => ({ answer: answer!, operation: operation! }),
    flush: () => {
      while (tasks.length) tasks.shift()!();
    },
  };
}

it("closing and reopening a restart with a lost response reconciles the account receipt without a second write", async () => {
  const f = fixture();
  f.mount();
  await act(async () => {
    await f.get().answer.onRestartRetry!();
  });
  act(() => {
    mounted!.unmount();
    mounted = undefined;
  });
  f.flush();
  f.mount();
  expect(f.get().answer.restartRetryLabel).toBe("Check restart");
  await act(async () => {
    await f.get().answer.onRestartRetry!();
  });
  const requestId = f.calls[0]!.slice(5);
  expect(f.calls).toEqual([`send:${requestId}`, `ask:${requestId}`]);
});
it("a retained FAILED tool result still offers Try again when process history is absent", () => {
  observations.available = false;
  const f = fixture();
  f.mount();
  expect(f.get().operation.phase).toBe("failed");
  expect(f.get().answer.restartRetryLabel).toBe("Try again");
  expect(f.get().answer.onRestartRetry).toBeTypeOf("function");
});
it("a refused retry shows the existing receipt's reason instead of the previous failure", async () => {
  const f = fixture("refused");
  f.mount();
  await act(async () => {
    await f.get().answer.onRestartRetry!();
  });
  expect(f.get().operation.closing).toBe("Project access could not be verified.");
  expect(f.get().operation.statusWord).toBe("Restart refused");
});

it("an accepted retry missing from history retains the new process identity and an unconfirmed outcome", async () => {
  const f = fixture("accepted");
  f.mount();
  await act(async () => {
    await f.get().answer.onRestartRetry!();
  });
  expect(f.get().operation.phase).toBe("uncertain");
  expect(f.get().operation.restartProcess).toMatchObject({ id: "new-process", status: "UNKNOWN" });
  expect(f.get().operation.closing).toBe(
    "Zerops accepted the restart. Its outcome is unconfirmed.",
  );
  expect(f.get().answer.restartRetryDisabled).toBe(true);
});
