import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const detail = vi.hoisted(() => ({ failure: null as null | { message: string } }));
vi.mock("~/zerops/accountEnvironments", () => ({
  useMateDetailRead: () => ({ failure: detail.failure, again: () => undefined }),
  useTryMateAgain: () => () => undefined,
}));
const QUILL = {
  name: "Quill",
  tint: "slate",
  shape: "squircle",
  project: "Orchard",
  projectUrl: "https://app.example.test/project",
  connected: false,
} as const;
const who = vi.hoisted(() => ({ at: { kind: "unknown" } as { kind: string; mate?: unknown } }));
vi.mock("~/zerops/useZeropsMates", () => ({ useZeropsMate: () => who.at }));
vi.mock("~/zerops/mateVoiceContext", () => ({ useMateVoice: () => ({ surface: "none" }) }));
vi.mock("./RouteStandIn", () => ({ RouteStandIn: () => <textarea data-stand-in="" /> }));
vi.mock("./WaitLine", () => ({
  PageWaitLine: ({ text }: { text: string | null }) => <p>{text}</p>,
}));
vi.mock("./ZeropsMateComingPage", () => ({
  MateComingFrame: (props: { header: ReactNode; composer?: ReactNode; children: ReactNode }) => (
    <main>
      <header>{props.header}</header>
      {props.children}
      {props.composer}
    </main>
  ),
  MateComingHeader: ({ mate }: { mate: { name: string } }) => <h1>{mate.name}</h1>,
}));
vi.mock("./MateLinkLine", () => ({ MateLinkLine: () => null, MateLinkProcesses: () => null }));
vi.mock("./ZeropsMateEmptyState", () => ({ MateEmptyStateView: () => null }));

import { MateOpeningView, MateLinkStage } from "./MateLinkStage";

const ref = scopeThreadRef(EnvironmentId.make("env-quill"), ThreadId.make("thread-ivy"));

describe("MateOpeningView: a conversation's page lands when its Mate is known, never on a guess", () => {
  it.each([
    [
      "who lives here unknown: the header's place held empty, the line unnamed, the composer in",
      { kind: "unknown" },
      ["<header></header>", "Opening the conversation…", "data-stand-in"],
      ["Quill"],
    ],
    [
      "the directory names the Mate: its face and name, its own line",
      { kind: "mate", mate: QUILL },
      ["<h1>Quill</h1>", "Opening Quill&#x27;s conversation…", "data-stand-in"],
      [],
    ],
  ] as const)("%s", (_case, at, shown, absent) => {
    who.at = at;
    try {
      const markup = renderToStaticMarkup(<MateOpeningView threadRef={ref} />);
      for (const text of shown) expect(markup).toContain(text);
      for (const text of absent) expect(markup).not.toContain(text);
    } finally {
      who.at = { kind: "unknown" };
    }
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
