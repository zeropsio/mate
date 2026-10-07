import { RegistryContext } from "@effect/atom-react";
import { seedHqNavigation, seedHqVerdict } from "@t3tools/client-runtime/data/fixtures";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import { projectNameInApp } from "@t3tools/client-runtime/zerops";
import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/zerops/accountEnvironments", () => ({
  useMateDetailRead: () => ({ failure: null, again: () => undefined }),
  useTryMateAgain: () => () => undefined,
}));
vi.mock("~/state/presentation", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return { environmentPresentations: { presentationsAtom: Atom.make(new Map()) } };
});
vi.mock("~/components/zerops/ZeropsMateComingPage", () => ({
  MateComingFrame: ({ header, children }: { header: ReactNode; children: ReactNode }) => (
    <main>
      {header}
      {children}
    </main>
  ),
  MateComingHeader: ({ mate }: { mate: { name: string; tint: string; shape: string } }) => (
    <h1 data-tint={mate.tint} data-shape={mate.shape}>
      {mate.name}
    </h1>
  ),
}));
vi.mock("~/components/zerops/ZeropsMateEmptyState", () => ({
  MateEmptyStateView: ({ coming }: { coming: { headline: string } }) => <h2>{coming.headline}</h2>,
}));

import { MateLinkStage } from "~/components/zerops/MateLinkStage";
import { candidateListingAtom } from "./useZeropsCandidates";
import { useZeropsMate } from "./useZeropsMates";
import { mateNoticeVoice } from "./mateNoticeVoice";
import { menuRowsAtom } from "./menuRows";

const ENV = EnvironmentId.make("env-quill");
const ORG = "org-orchard";
const PROJECT = { id: "quill", clientId: ORG, name: "Old listing name", status: "ACTIVE" };

function Opening() {
  const at = useZeropsMate(ENV);
  const voice = mateNoticeVoice({
    reachability: { kind: "connecting", waitingOn: "descriptor" },
    conversationShown: false,
    nowMs: 0,
    mateName: at.kind === "mate" ? at.mate.name : "The Mate",
  });
  return (
    <MateLinkStage
      environmentId={ENV}
      projectId={PROJECT.id}
      voice={
        voice.surface === "none"
          ? { surface: "stage", text: null, actions: [], processes: false }
          : voice
      }
    />
  );
}

describe("a Mate's first frame", () => {
  it("names and draws the menu's Mate in its stage and voice before the candidate listing is read", () => {
    const registry = AtomRegistry.make();
    const store = mountRoster(registry, ORG, [PROJECT]);
    seedHqVerdict(store, ORG, "official");
    seedHqNavigation(store, ORG, {
      structure: {
        apps: [
          {
            id: "orchard",
            name: "Orchard",
            projects: [
              {
                projectId: PROJECT.id,
                name: "Orchard - Quill",
                kind: "mate",
                mate: { face: "sky:seal" },
              },
            ],
          },
        ],
        ungrouped: [],
      },
      mates: {
        [PROJECT.id]: {
          presence: { online: true, since: "2026-10-07T00:00:00Z", overview: "live" },
          identity: { environmentId: ENV, serverVersion: "0.14.43", update: null },
        },
      },
    });
    expect(registry.get(candidateListingAtom).state).toBe("unread");
    const menu = registry.get(menuRowsAtom(ORG, []));
    expect(menu.settled).toBe(true);
    expect(projectNameInApp(menu.rows[0]?.project)).toBe("Quill");
    const firstFrame = renderToStaticMarkup(
      <RegistryContext.Provider value={registry}>
        <Opening />
      </RegistryContext.Provider>,
    );
    expect(firstFrame).toContain('data-tint="sky" data-shape="seal">Quill</h1>');
    expect(firstFrame).toContain("Quill is opening the conversation.</h2>");
    expect(firstFrame).not.toContain("The Mate is opening");
    registry.dispose();
  });
});
