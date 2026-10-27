import type { CreationRead, RunToEnd } from "@t3tools/client-runtime/data";
import { act, useEffect } from "react";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { CreationAsk } from "./newProjectBirth";
import { useRunNewProject } from "./useRunNewProject";

const setup = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn(), run: vi.fn() }));
type OperationIntent = Parameters<RunToEnd>[0];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let completed: Promise<void>;
vi.mock("./accountOperations", () => ({
  HQ_UNFOLLOWED: "HQ isn't answering.",
  useAccountOperations: () => ({ run: setup.run, readCreation: () => UNSENT }),
}));
vi.mock("./accountLifetime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accountLifetime")>()),
  captureAccountLifetime: () => () => true,
}));
vi.mock("./accountInvalidations", () => ({ invalidateZerops: vi.fn() }));
vi.mock("./zeropsDataContext", () => ({ useZeropsData: () => ({ organizationRef: () => null }) }));
vi.mock("./ZeropsSessionProvider", () => ({ useZeropsSession: () => ({ client: {} }) }));
vi.mock("./creations", () => ({
  runOnce: (_id: string, run: () => Promise<void>) => (completed = run()),
}));
vi.mock("./matePress", () => ({
  PRESS_MAY_HAVE_LANDED: "Check the original project.",
  beginPress: setup.begin,
  finishMateSetup: setup.finish,
  whilePressing: <T,>(run: () => Promise<T>) => run(),
}));

const NOT_SENT = { state: "not-sent", attempt: 0 } as const;
const UNSENT: CreationRead = {
  steps: { app: NOT_SENT, birth: NOT_SENT, project: NOT_SENT },
  appId: null,
  birthId: null,
  projectId: null,
};
const ASK: CreationAsk = {
  ask: {
    organizationId: "org-acme",
    birthId: "creation-1",
    name: "Garden",
    botName: "Nova",
    face: { tint: "rose", shape: "seal" },
    locationId: null,
    agents: [],
  },
  hq: { projectId: "hq-1", address: "https://hq.example" },
  startedAt: 0,
  presses: 1,
  refusedHere: null,
};
afterEach(() => vi.clearAllMocks());

describe("New project setup after platform creation", () => {
  it.each(["finished", "failed", "binding-refused"] as const)(
    "starts setup only after project.create ends: %s",
    async (outcome) => {
      const asked = deferred<void>();
      const creation = deferred<{ projectId: string }>();
      const bound = deferred<void>();
      setup.run.mockImplementation(
        async (intent: OperationIntent, options: Parameters<RunToEnd>[1]) => {
          if (intent.kind === "create-app") return { appId: "app-garden" };
          if (intent.kind === "record-birth") return { birthId: "birth-nova" };
          if (intent.kind === "bind-birth") return bound.promise;
          if (intent.kind === "create-project") {
            options.accepted?.({ projectId: "original-project" });
            asked.resolve();
            return creation.promise;
          }
          throw new Error(`Unexpected creation write: ${intent.kind}`);
        },
      );
      let run: ReturnType<typeof useRunNewProject>;
      function Probe() {
        const start = useRunNewProject();
        useEffect(() => {
          run = start;
        }, [start]);
        return null;
      }
      let tree: ReturnType<typeof create>;
      await act(async () => {
        tree = create(<Probe />);
      });
      run!(ASK);
      await asked.promise;
      expect(setup.run).toHaveBeenCalledWith(
        {
          kind: "bind-birth",
          orgId: "org-acme",
          appId: "app-garden",
          birthId: "birth-nova",
          projectId: "original-project",
        },
        expect.anything(),
      );
      expect(setup.finish).not.toHaveBeenCalled();
      if (outcome === "failed") creation.reject(new Error("Project capacity exhausted."));
      else creation.resolve({ projectId: "original-project" });
      await Promise.resolve();
      expect(setup.finish).not.toHaveBeenCalled();
      if (outcome === "binding-refused") bound.reject(new Error("HQ cannot keep this birth."));
      else bound.resolve();
      await completed!;
      if (outcome !== "finished") {
        expect(setup.begin).not.toHaveBeenCalled();
        expect(setup.finish).not.toHaveBeenCalled();
      } else {
        expect(setup.finish).toHaveBeenCalledTimes(1);
        expect(setup.finish.mock.calls[0]?.[0]).toMatchObject({
          projectId: "original-project",
          container: { agents: [] },
          registration: { groupId: "app-garden", intent: "birth-nova" },
        });
      }
      act(() => tree!.unmount());
    },
  );
});
