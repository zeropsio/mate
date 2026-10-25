// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { RegistryContext } from "@effect/atom-react";
import { makeAccountStore, type Projection } from "@t3tools/client-runtime/data";
import { hqKeptGitFamily, hqKeptGitScope } from "@t3tools/client-runtime/data";
import { openAccountLifetime, closeAccountLifetime } from "~/zerops/accountLifetime";
import { KeptGitQuestions } from "./KeptGitQuestions";

const state = vi.hoisted(() => ({
  submit: vi.fn(),
  store: undefined as ReturnType<typeof makeAccountStore> | undefined,
  registry: undefined as AtomRegistry.AtomRegistry | undefined,
}));
vi.mock("~/zerops/accountOperations", () => ({
  useAccountOperationsOptional: () => ({ submit: state.submit }),
}));
vi.mock("~/zerops/accountData", async () => {
  const { useAtomValue } = await import("@effect/atom-react");
  return {
    useAccountOrgId: () => "org",
    useProjection: <K, V>(projection: Projection<K, V>, key: K) =>
      useAtomValue(state.store!.data.project(projection, key)),
  };
});
const question = {
  appId: "shop",
  appName: "Shop",
  projectId: "gone",
  projectName: "Production",
  askedAt: "2026-10-25T09:00:00Z",
};
let root: Root;
let element: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.registry = AtomRegistry.make();
  state.store = makeAccountStore(state.registry);
  state.submit.mockReset().mockResolvedValue({ progress: { stage: "done", outcome: "succeeded" } });
  openAccountLifetime("person");
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await closeAccountLifetime();
  element.remove();
  vi.unstubAllGlobals();
});
const render = () =>
  act(async () =>
    root.render(
      <RegistryContext.Provider value={state.registry!}>
        <KeptGitQuestions />
      </RegistryContext.Provider>,
    ),
  );
const arrive = () =>
  act(async () => {
    state.store!.dispatch({
      kind: "baseline-commit",
      via: "hq-stream",
      scope: hqKeptGitScope("org"),
      generation: 0,
      members: [question.appId],
      rows: [
        {
          family: "hqKeptGit",
          id: question.appId,
          revision: { kind: "hq", incarnation: "i", revision: 1 },
          value: hqKeptGitFamily.hq!.decode(question, "keptGit:shop")!,
        },
      ],
    });
  });
function button(label: string) {
  return [...element.querySelectorAll("button")].find((node) => node.textContent === label)!;
}
it("shows an arriving removed-project question, keeps Git by default, and sends only the chosen answer", async () => {
  await render();
  expect(element.textContent).toBe("");
  await arrive();
  expect(element.textContent).toContain("Production was removed. Keep its Git?");
  expect(element.textContent).toContain(
    "Its Git stays kept and billed as storage until you delete it.",
  );
  expect(state.submit).not.toHaveBeenCalled();
  await act(async () => button("Keep Git").click());
  expect(state.submit).toHaveBeenCalledWith(
    { kind: "answer-kept-git", orgId: "org", appId: "shop", answer: "keep" },
    "kept-git/org/shop/2026-10-25T09%3A00%3A00Z/1",
  );
});
it("deletes kept Git only after a separate confirmation and preserves HQ's refusal", async () => {
  await render();
  await arrive();
  await act(async () => button("Delete Git…").click());
  expect(state.submit).not.toHaveBeenCalled();
  expect(element.textContent).toContain("Delete Shop and its Git?");
  await act(async () => button("Cancel").click());
  expect(button("Keep Git")).toBeDefined();
  state.submit.mockResolvedValue({
    progress: { stage: "refused", reason: "This question is no longer open." },
  });
  await act(async () => button("Delete Git…").click());
  await act(async () => button("Delete Git").click());
  expect(state.submit.mock.calls[0]?.[0]).toEqual({
    kind: "answer-kept-git",
    orgId: "org",
    appId: "shop",
    answer: "delete",
  });
  expect(element.querySelector('[role="status"]')?.textContent).toBe(
    "This question is no longer open.",
  );
});
it("withdraws the question when HQ removes the reader's access", async () => {
  await render();
  await arrive();
  await act(async () =>
    state.store!.dispatch({ kind: "access", family: "hqKeptGit", id: "shop", access: "denied" }),
  );
  expect(element.textContent).toBe("");
});

it("reports a lost kept-Git answer without inviting a repeat", async () => {
  await render();
  await arrive();
  state.submit.mockResolvedValue({ progress: { stage: "uncertain", next: "ask-owner-again" } });
  await act(async () => button("Keep Git").click());
  expect(element.querySelector('[role="status"]')?.textContent).toBe(
    "HQ has not confirmed your answer.",
  );
});
