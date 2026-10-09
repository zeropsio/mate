import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { MATE_SHAPE_IDS, MATE_TINT_IDS } from "@t3tools/shared/brand";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";
import type { ZeropsMateDirectory } from "./mateIdentities";
import { useMateStandUpAskLine } from "./useMateStandUp";

const facts = vi.hoisted(() => ({
  directory: new Map() as ZeropsMateDirectory,
  viewer: undefined as string | undefined,
}));
vi.mock("./useZeropsMates", () => ({ useZeropsMateDirectory: () => facts.directory }));
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () => ({ user: { id: facts.viewer } }),
}));
vi.mock("./useZeropsFeeds", () => ({ useZeropsAgentAuth: () => undefined }));
vi.mock("../state/entities", () => ({
  useThreadShells: () => [
    { environmentId: "fen", id: "main", archivedAt: null, modelSelection: { instanceId: "codex" } },
  ],
}));

const environmentId = EnvironmentId.make("fen");
function AskLine() {
  return useMateStandUpAskLine({ environmentId, threadId: ThreadId.make("main") });
}

it.each([
  { requester: "petra", viewer: "ada", line: "Fen was asked to stand up development of Letopis" },
  { requester: "ada", viewer: "ada", line: "You asked Fen to stand up development of Letopis" },
  { requester: undefined, viewer: "ada", line: "Fen was asked to stand up development of Letopis" },
  {
    requester: "petra",
    viewer: undefined,
    line: "Fen was asked to stand up development of Letopis",
  },
])(
  "The stand-up ask names its recorded requester ($requester, viewer $viewer)",
  ({ requester, viewer, line }) => {
    facts.viewer = viewer;
    facts.directory = new Map([
      [
        environmentId,
        {
          name: "Fen",
          project: "Letopis",
          projectUrl: "https://example.test/project",
          tint: MATE_TINT_IDS[0],
          shape: MATE_SHAPE_IDS[0],
          connected: true,
          ...(requester === undefined ? {} : { standUp: { by: requester } }),
        },
      ],
    ]);
    expect(renderToStaticMarkup(createElement(AskLine))).toBe(line);
  },
);
