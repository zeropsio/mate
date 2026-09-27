import type { ZeropsAgentAuthSnapshot, ZeropsLogin } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { crewSnapshotFixture } from "./crew/testing/fixtures.ts";
import { mateLoginChoices, mateLoginRows, mateLoginSignerLine } from "./logins.ts";

const EVA = "u-eva";
const JAN = "u-jan";

const login = (patch: Partial<ZeropsLogin> & Pick<ZeropsLogin, "id">): ZeropsLogin => ({
  agent: "claude-code",
  label: "",
  kind: "subscription",
  default: false,
  state: "authorized",
  token: false,
  ...patch,
});

const snapshot = (logins: ReadonlyArray<ZeropsLogin> | undefined): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents: [],
  ...(logins === undefined ? {} : { logins }),
});

describe("mateLoginRows", () => {
  it("titles every login and names the crewmates that run on it", () => {
    const base = crewSnapshotFixture();
    const [first, second] = base.crewmates;
    const crew = {
      crewmates: [
        {
          ...first!,
          handle: "backend",
          login: { id: "claudeAgent", label: "", agent: "claude-code" },
        },
        {
          ...second!,
          handle: "frontend",
          login: { id: "claudeAgent-work", label: "work", agent: "claude-code" },
        },
      ],
    } as const;

    const rows = mateLoginRows(
      snapshot([
        login({ id: "claudeAgent", default: true, signedInBy: EVA }),
        login({ id: "claudeAgent-work", label: "work", signedInBy: EVA }),
        login({ id: "codex", agent: "codex", default: true, state: "not-authorized" }),
      ]),
      crew,
    );

    expect(rows.map((row) => [row.id, row.title, row.crewmates])).toEqual([
      ["claudeAgent", "Claude Code", ["backend"]],
      ["claudeAgent-work", "Claude Code · work", ["frontend"]],
      ["codex", "Codex", []],
    ]);
  });

  it("lists nothing from a server that lists no logins, or no feed at all", () => {
    expect(mateLoginRows(snapshot(undefined), null)).toEqual([]);
    expect(mateLoginRows(null, null)).toEqual([]);
  });
});

describe("mateLoginSignerLine", () => {
  it.each([
    [login({ id: "claudeAgent", default: true, signedInBy: EVA }), "Signed in by you"],
    [login({ id: "claudeAgent-cleo", signedInBy: JAN }), "Signed in by Jan"],
    [login({ id: "claudeAgent-x", signedInBy: "u-left" }), "Signed in by another member"],
    [login({ id: "codex-home", agent: "codex", state: "not-authorized" }), "Not signed in"],
    [login({ id: "claudeAgent-y" }), "Sign-in not recorded"],
    [login({ id: "claudeAgent-key", kind: "apiKey", signedInBy: EVA }), "Added by you"],
    [login({ id: "claudeAgent-key", kind: "apiKey", signedInBy: JAN }), "Added by Jan"],
    [login({ id: "claudeAgent-key", kind: "apiKey", state: "not-authorized" }), "No key stored"],
    [
      login({ id: "codex", agent: "codex", default: true, token: true }),
      "Authorized by a project token",
    ],
  ])("%o reads %s", (row, line) => {
    expect(mateLoginSignerLine(row, EVA, (userId) => (userId === JAN ? "Jan" : undefined))).toBe(
      line,
    );
  });
});

// N9: a crewmate runs only on a login its person signed in, or on a project
// token — what the server's admission accepts, row for row.
describe("mateLoginChoices", () => {
  it.each([
    [login({ id: "claudeAgent-mine", signedInBy: EVA }), { usable: true }],
    [login({ id: "claudeAgent-mine", signedInBy: EVA, state: "registering" }), { usable: true }],
    [login({ id: "codex", agent: "codex", default: true, token: true }), { usable: true }],
    [
      login({ id: "claudeAgent-cleo", signedInBy: JAN }),
      {
        usable: false,
        reason: "Signed in by another project member — only their crews can use it.",
      },
    ],
    [
      login({ id: "claudeAgent-y" }),
      {
        usable: false,
        reason: "Its sign-in was not recorded by Zerops Mate, so nobody can run it.",
      },
    ],
    [
      login({ id: "codex-home", agent: "codex", label: "home", state: "not-authorized" }),
      {
        usable: false,
        reason: "Codex · home is not signed in on this project. Sign it in to use it.",
      },
    ],
  ])("%o → %o", (row, use) => {
    const [choice] = mateLoginChoices(mateLoginRows(snapshot([row]), null), EVA);
    expect(choice?.use).toEqual(use);
  });
});
