import { describe, expect, it } from "vite-plus/test";

import { crewmateMenuModel, type CrewmateMenuItemId } from "./CrewmateMenu.logic";

const WRITER = {
  kind: "writer",
  displayName: "World Server",
  jobFirstLine: "Owns the world server under server/ and its tests. Writes them first.",
} as const;

describe("crewmateMenuModel", () => {
  it.each([
    {
      job: "Owns the world server under server/ and its tests. Writes them first.",
      heading: "Owns the world server under server/ and its tests.",
    },
    {
      job: "You own World Server: the server under server/ and its tests. Write them first.",
      heading: "The server under server/ and its tests.",
    },
  ])(
    "heads the menu with the job's first sentence, as the person reads it: $job",
    ({ job, heading }) => {
      expect(
        crewmateMenuModel({
          crewmate: { ...WRITER, jobFirstLine: job },
          mateName: "Fen",
          tries: null,
          busy: false,
        }).heading,
      ).toBe(heading);
    },
  );

  it.each<{
    readonly name: string;
    readonly input: Omit<Parameters<typeof crewmateMenuModel>[0], "mateName">;
    readonly items: ReadonlyArray<readonly [CrewmateMenuItemId, string, string | null, boolean]>;
  }>([
    {
      name: "a writer whose app runs on its own: try it, stop it, its job, a clean start",
      input: {
        crewmate: WRITER,
        tries: { where: "own", enabled: true, stops: true },
        busy: false,
      },
      items: [
        ["try", "Try its work", "Opens its copy of the app. Nothing is in Fen's code yet.", true],
        ["stop", "Stop its app", null, true],
        ["job", "Change its job", "What it's responsible for.", true],
        ["clear", "Clear its conversation", "It keeps its job and its work.", true],
      ],
    },
    {
      name: "a writer whose app is stopped: no Stop",
      input: {
        crewmate: WRITER,
        tries: { where: "own", enabled: true, stops: false },
        busy: false,
      },
      items: [
        ["try", "Try its work", "Opens its copy of the app. Nothing is in Fen's code yet.", true],
        ["job", "Change its job", "What it's responsible for.", true],
        ["clear", "Clear its conversation", "It keeps its job and its work.", true],
      ],
    },
    {
      name: "a writer whose app cannot run on its own: tried at the Mate's dev address",
      input: {
        crewmate: WRITER,
        tries: { where: "dev", enabled: true, stops: false },
        busy: false,
      },
      items: [
        [
          "try",
          "Try its work",
          "Opens it at Fen's dev address. Nothing is in Fen's code yet.",
          true,
        ],
        ["job", "Change its job", "What it's responsible for.", true],
        ["clear", "Clear its conversation", "It keeps its job and its work.", true],
      ],
    },
    {
      name: "a writer with nothing to open yet: Try its work waits",
      input: {
        crewmate: WRITER,
        tries: { where: "dev", enabled: false, stops: false },
        busy: false,
      },
      items: [
        [
          "try",
          "Try its work",
          "Opens it at Fen's dev address. Nothing is in Fen's code yet.",
          false,
        ],
        ["job", "Change its job", "What it's responsible for.", true],
        ["clear", "Clear its conversation", "It keeps its job and its work.", true],
      ],
    },
    {
      name: "while a press is on its way: only its editor opens",
      input: {
        crewmate: WRITER,
        tries: { where: "own", enabled: true, stops: true },
        busy: true,
      },
      items: [
        ["try", "Try its work", "Opens its copy of the app. Nothing is in Fen's code yet.", false],
        ["stop", "Stop its app", null, false],
        ["job", "Change its job", "What it's responsible for.", true],
        ["clear", "Clear its conversation", "It keeps its job and its work.", false],
      ],
    },
    {
      name: "a reader, with no copy of the code: its job and a clean start",
      input: {
        crewmate: { kind: "reader", displayName: "Docs", jobFirstLine: "Reviews each change." },
        tries: null,
        busy: false,
      },
      items: [
        ["job", "Change its job", "What it's responsible for.", true],
        ["clear", "Clear its conversation", "It keeps its job and its work.", true],
      ],
    },
    {
      name: "the lead: the crew's brief and a clean start",
      input: {
        crewmate: {
          kind: "lead",
          displayName: "Lead",
          jobFirstLine: "Turns the brief into tasks.",
        },
        tries: null,
        busy: false,
      },
      items: [
        ["brief", "Change the brief", "What the whole crew works toward.", true],
        ["clear", "Clear its conversation", "It keeps its job and its work.", true],
      ],
    },
  ])("$name", ({ input, items }) => {
    expect(
      crewmateMenuModel({ ...input, mateName: "Fen" }).items.map((item) => [
        item.id,
        item.label,
        item.line,
        item.enabled,
      ]),
    ).toEqual(items);
  });
});
