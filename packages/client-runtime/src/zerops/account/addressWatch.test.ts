import { describe, expect, it } from "vite-plus/test";

import { addressWatchedProjects } from "./addressWatch.ts";

type Row = Parameters<typeof addressWatchedProjects>[0]["rows"][number];

const row = (projectId: string, over: Partial<Row> = {}): Row => ({
  presence: "known",
  project: { id: projectId },
  group: "provisioning",
  service: { status: "ACTIVE" },
  containerOrigin: undefined,
  ...over,
});

describe("which projects a window watches for a container's address to land", () => {
  it.each([
    {
      sentence:
        "watches a Mate coming up in every window that lists it, though no screen shows it, so its readiness reaches teammates and the creator's other windows",
      rows: [row("p-coming")],
      shown: [],
      watched: ["p-coming"],
    },
    {
      sentence: "watches a project a screen shows whose container lacks its address",
      rows: [row("p-shown", { group: "unavailable" })],
      shown: ["p-shown"],
      watched: ["p-shown"],
    },
    {
      sentence: "leaves a container whose public access is off unwatched where no screen shows it",
      rows: [row("p-off", { group: "unavailable" })],
      shown: [],
      watched: [],
    },
    {
      sentence: "lets the watch go once the address landed",
      rows: [row("p-up", { group: "ready", containerOrigin: "https://p-up.example" })],
      shown: ["p-up"],
      watched: [],
    },
    {
      sentence: "watches nothing for a container that is not running yet: its build says that",
      rows: [row("p-build", { service: { status: "READY_TO_DEPLOY" } })],
      shown: ["p-build"],
      watched: [],
    },
    {
      sentence: "watches nothing of another organization",
      rows: [row("p-elsewhere")],
      shown: ["p-elsewhere"],
      watched: [],
      elsewhere: true,
    },
  ])("$sentence", ({ rows, shown, watched, elsewhere }) => {
    expect([
      ...addressWatchedProjects({
        rows,
        shown: new Set(shown),
        inOrganization: () => elsewhere !== true,
      }),
    ]).toEqual(watched);
  });
});
