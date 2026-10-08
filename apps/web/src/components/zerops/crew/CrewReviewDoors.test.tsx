// @vitest-environment happy-dom
import { crewAccess } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { EnvironmentId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { ReviewContext } from "../../../zerops/review";
import { readCrewThread } from "../../../zerops/crew/useCrew";
import { CrewSectionHost } from "./CrewSectionHost";

vi.mock("../../../zerops/crew/useCrewTry", () => ({ useCrewTry: () => null }));

const command = vi.hoisted(() => vi.fn(async () => null));
vi.mock("../../../zerops/crew/useCrewCommand", () => ({
  useCrewCommand: () => ({ send: command, pending: false, error: null, errorAt: () => null }),
}));
vi.mock("../../../zerops/crew/crewTab", () => ({ useCrewView: () => [null, vi.fn()] }));
vi.mock("../../../state/entities", () => ({ useServerConfigs: () => new Map() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

it.each([
  ["a crew row", "Review", "task-13"],
  ["work already in the Mate's code", "Camera shake on hit", "task-10"],
] as const)("%s opens the task's review and lands nothing", async (_door, label, taskId) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  command.mockClear();
  const source = crewSnapshotFixture();
  const snapshot = {
    ...source,
    attention: source.attention.map((need) =>
      need.taskId === "task-13" ? { ...need, kind: "ready-to-land" as const, paths: [] } : need,
    ),
    board: {
      ...source.board,
      tasks: source.board.tasks.map((task) =>
        task.id === "task-13" ? { ...task, state: "ready" as const, waitingOn: [] } : task,
      ),
    },
  };
  const access = crewAccess({
    snapshot,
    lockOf: () => null,
    defaultLogin: "claudeAgent",
    reading: false,
  });
  const view = deriveCrewView(snapshot, [], readCrewThread);
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  const openReview = vi.fn();
  try {
    await act(() =>
      root.render(
        <ReviewContext.Provider value={openReview}>
          <CrewSectionHost
            environmentId={EnvironmentId.make("env-fen")}
            snapshot={snapshot}
            view={view}
            current
            mate={{ name: "Fen", tint: "amber" }}
            treeCwd={null}
            onAskMate={vi.fn()}
            access={access}
            askLock={null}
            onSignIn={vi.fn()}
          />
        </ReviewContext.Provider>,
      ),
    );
    const button = Array.from(document.querySelectorAll("button")).find((node) =>
      node.textContent?.trim().toLowerCase().includes(label.toLowerCase()),
    );
    expect(
      button,
      Array.from(document.querySelectorAll("button"))
        .map((node) => node.textContent)
        .join(" | "),
    ).toBeDefined();
    await act(() => button!.click());
    expect(openReview).toHaveBeenCalledExactlyOnceWith(
      { kind: "crew-task", environmentId: "env-fen", taskId },
      { from: button },
    );
    expect(command).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  }
});
