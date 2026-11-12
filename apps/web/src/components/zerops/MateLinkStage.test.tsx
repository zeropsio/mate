import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import * as entities from "~/state/entities";
import * as environments from "~/zerops/accountEnvironments";
import * as mates from "~/zerops/useZeropsMates";
import * as readings from "~/zerops/useMenuMateReadings";
import * as voice from "~/zerops/mateVoiceContext";
import * as route from "./RouteStandIn";
import * as comingPage from "./ZeropsMateComingPage";
import * as link from "./MateLinkLine";
import * as emptyState from "./ZeropsMateEmptyState";

const detail = { failure: null as null | { message: string } };
const QUILL = {
  name: "Quill",
  tint: "slate",
  shape: "squircle",
  project: "Orchard",
  projectUrl: "https://app.example.test/project",
  connected: false,
} as const;
const who = { at: { kind: "unknown" } as { kind: string; mate?: unknown } };
const told = { projectId: "", activity: undefined as unknown };

beforeEach(() => {
  vi.spyOn(entities, "useThreadDetail").mockReturnValue(false as never);
  vi.spyOn(environments, "useMateDetailRead").mockImplementation(() => ({
    failure: detail.failure,
    again: () => undefined,
  }));
  vi.spyOn(environments, "useTryMateAgain").mockReturnValue(() => undefined);
  vi.spyOn(mates, "useZeropsMate").mockImplementation(
    () => who.at as ReturnType<typeof mates.useZeropsMate>,
  );
  vi.spyOn(readings, "useToldActivity").mockImplementation((projectId) =>
    projectId === told.projectId
      ? (told.activity as ReturnType<typeof readings.useToldActivity>)
      : undefined,
  );
  vi.spyOn(voice, "useMateVoice").mockReturnValue({ surface: "none" });
  vi.spyOn(route, "RouteStandIn").mockImplementation(() => <textarea data-stand-in="" />);
  vi.spyOn(comingPage, "MateComingFrame").mockImplementation((props) => (
    <main>
      <header>{props.header}</header>
      {props.children}
      {props.composer}
    </main>
  ));
  vi.spyOn(comingPage, "MateComingHeader").mockImplementation(({ mate }) => <h1>{mate.name}</h1>);
  vi.spyOn(comingPage, "HeaderControlsStandIn").mockImplementation(() => <i data-controls="" />);
  vi.spyOn(link, "MateLinkLine").mockImplementation((props) => (
    <div data-line={props.voice.text} data-project-url={props.projectUrl ?? ""}>
      {props.onTryNow === undefined ? null : <button>Try now</button>}
    </div>
  ));
  vi.spyOn(link, "MateLinkProcesses").mockImplementation(() => <ol data-processes="" />);
  vi.spyOn(emptyState, "MateConnectionState").mockImplementation((props) => (
    <section>
      <h2>{props.headline}</h2>
      <p>{props.secondary}</p>
    </section>
  ));
  vi.spyOn(emptyState, "MateEmptyStateView").mockImplementation((props) => (
    <section data-empty-state={props.mate === null ? "unnamed" : props.mate.name}>
      <h2>{props.coming?.headline}</h2>
      <p>{props.coming?.sentence}</p>
      {props.coming?.below}
    </section>
  ));
});
afterEach(() => vi.restoreAllMocks());

import { MateOpeningView, MateLinkStage } from "./MateLinkStage";

const ref = scopeThreadRef(EnvironmentId.make("env-quill"), ThreadId.make("thread-ivy"));

describe("MateOpeningView: a conversation's page lands when its Mate is known, never on a guess", () => {
  // witness: apps/web/src/components/zerops/MateLinkStage.tsx | {panel === null && opens ? <HeaderControlsStandIn /> : null} → {null}
  it.each([
    [
      "who lives here unknown: the header holds its controls alone, the line unnamed, the composer in",
      { kind: "unknown" },
      ['<header><i data-controls=""></i></header>', "Opening the conversation.", "data-stand-in"],
      ["Quill", "The Mate"],
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

  it("opening, it names the limit HQ told of the Mate the directory names there", () => {
    who.at = { kind: "mate", mate: { ...QUILL, projectId: "project-orchard" } };
    told.projectId = "project-orchard";
    told.activity = { limitHistory: { provider: "Claude", resetsAt: null } };
    try {
      const markup = renderToStaticMarkup(<MateOpeningView threadRef={ref} />);
      expect(markup).toContain("Quill hit the Claude limit.");
      expect(markup).not.toContain("Picking up where it left off.");
    } finally {
      who.at = { kind: "unknown" };
      told.activity = undefined;
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
