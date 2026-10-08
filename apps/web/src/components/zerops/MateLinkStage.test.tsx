import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const detail = vi.hoisted(() => ({ failure: null as null | { message: string } }));
vi.mock("~/state/entities", () => ({ useThreadDetail: () => false }));
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
  PageWaitLine: ({ text, below }: { text: string | null; below?: ReactNode }) => (
    <p>
      {text}
      {below}
    </p>
  ),
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
vi.mock("./MateLinkLine", () => ({
  MateLinkLine: (props: {
    onTryNow?: () => void;
    projectUrl?: string;
    voice: { text: string };
  }) => (
    <div data-line={props.voice.text} data-project-url={props.projectUrl ?? ""}>
      {props.onTryNow === undefined ? null : <button>Try now</button>}
    </div>
  ),
  MateLinkProcesses: () => <ol data-processes="" />,
}));
vi.mock("./ZeropsMateEmptyState", () => ({
  MateConnectionState: (props: { headline: string; secondary: string }) => (
    <section>
      <h2>{props.headline}</h2>
      <p>{props.secondary}</p>
    </section>
  ),
  MateEmptyStateView: (props: {
    mate: { name: string } | null;
    coming: { below: ReactNode; headline?: string; sentence?: string } | null;
  }) => (
    <section data-empty-state={props.mate === null ? "unnamed" : props.mate.name}>
      <h2>{props.coming?.headline}</h2>
      <p>{props.coming?.sentence}</p>
      {props.coming?.below}
    </section>
  ),
}));

import { MateOpeningView, MateLinkStage } from "./MateLinkStage";

const ref = scopeThreadRef(EnvironmentId.make("env-quill"), ThreadId.make("thread-ivy"));

describe("MateOpeningView: a conversation's page lands when its Mate is known, never on a guess", () => {
  it.each([
    [
      "who lives here unknown: the header's place held empty, the line unnamed, the composer in",
      { kind: "unknown" },
      ["<header></header>", "The Mate is opening the conversation.", "data-stand-in"],
      ["Quill"],
    ],
    [
      "the directory names the Mate: its face and name, its own line",
      { kind: "mate", mate: QUILL },
      ["<h1>Quill</h1>", "Quill is opening the conversation.", "data-stand-in"],
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

  // Nothing in the link's slot needs the name: unnamed, the page is the named one's, its face and
  // headline places held, so nothing moves when the name arrives.
  it.each([
    ["unnamed", { kind: "unknown" }, ["<header></header>", 'data-empty-state="unnamed"']],
    ["named", { kind: "mate", mate: QUILL }, ["<h1>Quill</h1>", 'data-empty-state="Quill"']],
  ] as const)("while the link speaks, %s: the same stage with its verbs", (_case, at, shown) => {
    who.at = at;
    try {
      const markup = renderToStaticMarkup(
        <MateLinkStage
          composer={<textarea data-stand-in="" />}
          environmentId={ref.environmentId}
          projectId="project-orchard"
          voice={{
            surface: "stage",
            text: "Reconnecting…",
            actions: ["try-now", "open-in-zerops"],
            processes: false,
          }}
        />,
      );
      for (const text of shown) expect(markup).toContain(text);
      expect(markup).toContain("Reconnecting…</h2>");
      expect(markup).toContain("Try now</button>");
      expect(markup).toMatch(/data-project-url="[^"]+"/u);
      expect(markup).toContain("data-stand-in");
    } finally {
      who.at = { kind: "unknown" };
    }
  });

  it.each([
    ["unnamed", { kind: "unknown" }],
    ["named", { kind: "mate", mate: QUILL }],
  ] as const)("while the link is opening, %s: no recovery action or service noise", (_case, at) => {
    who.at = at;
    try {
      const markup = renderToStaticMarkup(
        <MateLinkStage
          environmentId={ref.environmentId}
          projectId="project-orchard"
          voice={{ surface: "stage", text: null, actions: [], processes: false }}
        />,
      );
      expect(markup).not.toContain("Try now</button>");
      expect(markup).not.toContain("data-processes");
    } finally {
      who.at = { kind: "unknown" };
    }
  });
});

it.each([
  ["unknown", { kind: "unknown" }, "The Mate"],
  ["known", { kind: "mate", mate: QUILL }, "Quill"],
  ["no Mate named", { kind: "nobody" }, "The Mate"],
] as const)(
  "%s: a refused inventory read names the failure and offers Again",
  (_case, at, name) => {
    who.at = at;
    detail.failure = { message: "The account receiver budget is full." };
    try {
      const markup = renderToStaticMarkup(
        <MateLinkStage
          environmentId={ref.environmentId}
          projectId={null}
          voice={{ surface: "stage", text: null, actions: [], processes: false }}
        />,
      );
      expect(markup).toContain(`${name}&#x27;s project could not be read.`);
      expect(markup).toContain("The account receiver budget is full.");
      expect(markup).toContain("Again</button>");
      expect(markup).not.toContain("Opening");
    } finally {
      detail.failure = null;
      who.at = { kind: "unknown" };
    }
  },
);
