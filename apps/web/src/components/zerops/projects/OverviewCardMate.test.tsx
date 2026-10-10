import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const linked = vi.hoisted(() => ({ value: false }));

// The menu row's own reads, as a card reads them for the same Mate.
vi.mock("~/zerops/useMenuMateReadings", () => ({ useMateLinkedInHq: () => linked.value }));
vi.mock("~/zerops/useZeropsMateOwners", async (original) => ({
  ...(await original<typeof import("~/zerops/useZeropsMateOwners")>()),
  useHqProjectPerson: () => ({ waitsOnViewer: true, owner: null }),
}));
vi.mock("~/zerops/deletingMates", () => ({
  useDeletingMates: () => new Set<string>(),
  mateDeleting: () => false,
}));
vi.mock("~/zerops/useMateMoments", () => ({
  useMateFaceWatch: () => ({
    restarting: false,
    watched: { backs: 0, moved: undefined, arrived: undefined },
  }),
}));
vi.mock("~/zerops/useNowMs", () => ({ useNowMs: () => 0, useSecondsNowMs: () => 0 }));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { timestampFormat: string }) => unknown) =>
    select({ timestampFormat: "locale" }),
}));
vi.mock("~/zerops/useAskMate", () => ({ useAskMate: () => () => {} }));
vi.mock("~/zerops/fixRequest", () => ({ useAskMateToFix: () => () => {} }));
vi.mock("~/zerops/review", () => ({ useOpenReview: () => () => {} }));
vi.mock("~/zerops/useZeropsAgentActivity", () => ({ useProjectMateActivity: () => undefined }));
vi.mock("~/zerops/ZeropsSessionProvider", () => ({ useZeropsSessionOptional: () => null }));
vi.mock("~/zerops/useMateWrite", () => ({ useMateWrite: () => ({ requests: {} }) }));

import { OverviewCardMate } from "./OverviewCardMate";

function ada(group: ZeropsCandidate["group"]): ZeropsCandidate {
  return {
    key: "ada:zcp",
    group,
    project: { id: "ada", name: "Ada", status: "ACTIVE", tagList: [] },
  } as ZeropsCandidate;
}

const faceOf = (markup: string) => /data-mate-face-state="([^"]+)"/u.exec(markup)?.[1];

describe("a Mate on its card", () => {
  // One Mate wears one face: the card reads it as the menu row does (`mateAwake`, `mateFace`).
  it.each([
    { case: "HQ holds its link open", group: "unavailable", hq: true, face: "idle" },
    { case: "its container runs", group: "ready", hq: false, face: "idle" },
    { case: "neither", group: "unavailable", hq: false, face: "sleep" },
  ] as const)("wears the face its menu row wears: $case", ({ group, hq, face }) => {
    linked.value = hq;
    const markup = renderToStaticMarkup(
      <OverviewCardMate
        candidate={ada(group)}
        change={undefined}
        containerActions={null}
        containerLine={undefined}
        conversationsRead
        flow={undefined}
        groupId="shop"
        name="Ada"
        onOpen={undefined}
        outsideHq={false}
        shape={undefined}
        tint="sky"
      />,
    );
    expect(faceOf(markup)).toBe(face);
    expect(markup).toContain("Nothing asked yet");
  });
});
