import { describe, expect, it } from "vite-plus/test";

import { projectActivitySnapshotOf } from "./useProjectActivity";

const READ = {
  retained: [],
  processes: [],
  running: [],
  live: true,
  reconnecting: false,
  history: "read",
} as const;

describe("projectActivitySnapshotOf — what a surface reads of a project's processes", () => {
  it.each([
    {
      name: "live",
      read: READ,
      snapshot: { processes: [], live: true, processHistory: "read" },
    },
    {
      name: "catching up: what it holds, said",
      read: { ...READ, live: false, reconnecting: true, history: "reading" },
      snapshot: { processes: [], live: false, reconnecting: true, processHistory: "reading" },
    },
    {
      name: "refused: why",
      read: { ...READ, live: false, unavailableReason: "forbidden", history: "unread" },
      snapshot: {
        processes: [],
        live: false,
        unavailableReason: "forbidden",
        processHistory: "unread",
      },
    },
  ] as const)("$name", ({ read, snapshot }) => {
    expect(projectActivitySnapshotOf(read)).toEqual(snapshot);
  });
});
