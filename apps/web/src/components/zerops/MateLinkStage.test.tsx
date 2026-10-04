import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const detail = vi.hoisted(() => ({ failure: null as null | { message: string } }));
vi.mock("~/zerops/accountEnvironments", () => ({
  useMateDetailRead: () => ({ failure: detail.failure, again: () => undefined }),
}));
vi.mock("~/connection/catalog", () => ({ environmentCatalog: { retryNow: {} } }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => () => undefined }));
vi.mock("~/zerops/useZeropsMates", () => ({ useZeropsMate: () => ({ kind: "unknown" }) }));
vi.mock("~/zerops/mateVoiceContext", () => ({ useMateVoice: () => ({ surface: "none" }) }));
vi.mock("~/zerops/mateIdentityMemory", () => ({
  rememberedMateIdentity: () => ({
    name: "Quill",
    tint: "slate",
    shape: "squircle",
    project: "Orchard",
    projectUrl: "https://app.example.test/project",
    connected: false,
  }),
}));
vi.mock("./RouteStandIn", () => ({ RouteStandIn: () => <textarea data-stand-in="" /> }));
vi.mock("./WaitLine", () => ({
  PageWaitLine: ({ text }: { text: string | null }) => <p>{text}</p>,
}));
vi.mock("./ZeropsMateComingPage", () => ({
  MateComingFrame: (props: { header: ReactNode; composer?: ReactNode; children: ReactNode }) => (
    <main>
      {props.header}
      {props.children}
      {props.composer}
    </main>
  ),
  MateComingHeader: ({ mate }: { mate: { name: string } }) => <h1>{mate.name}</h1>,
}));
vi.mock("./MateLinkLine", () => ({ MateLinkLine: () => null, MateLinkProcesses: () => null }));
vi.mock("./ZeropsMateEmptyState", () => ({ MateEmptyStateView: () => null }));

import { HomeOpeningView, MateOpeningView, MateLinkStage } from "./MateLinkStage";

const ref = scopeThreadRef(EnvironmentId.make("env-quill"), ThreadId.make("thread-ivy"));

describe("HomeOpeningView: the home's guess at its landing takes no input", () => {
  it("draws the Mate's face, name and opening line, and no composer", () => {
    const markup = renderToStaticMarkup(<HomeOpeningView environmentId={ref.environmentId} />);
    expect(markup).toContain("Quill");
    expect(markup).toContain("Opening Quill&#x27;s conversation…");
    expect(markup).not.toMatch(/<textarea|<input|contenteditable|<button/u);
  });

  it("where a conversation's own route opens, its composer stands in", () => {
    expect(renderToStaticMarkup(<MateOpeningView threadRef={ref} />)).toContain("data-stand-in");
  });
});

it("an unknown Mate's refused inventory read names the failure and offers Again", () => {
  detail.failure = { message: "The account receiver budget is full." };
  try {
    const markup = renderToStaticMarkup(
      <MateLinkStage
        environmentId={ref.environmentId}
        projectId={null}
        voice={{ surface: "stage", text: null, actions: [], processes: false }}
      />,
    );
    expect(markup).toContain("Could not read this Mate");
    expect(markup).toContain("The account receiver budget is full.");
    expect(markup).toContain("Again</button>");
    expect(markup).not.toContain("Opening");
  } finally {
    detail.failure = null;
  }
});
