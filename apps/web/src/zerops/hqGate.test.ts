import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import type { OfficialHq } from "@t3tools/client-runtime/zerops/hq";
import { describe, expect, it } from "vite-plus/test";

import { HQ_UNCLEAR, resolveHqGate } from "./hqGate";

const OFFICIAL: OfficialHq = {
  kind: "official",
  projectId: "hq1",
  address: "https://hq-30db-8080.prg1.zerops.app",
};
const NONE: OfficialHq = { kind: "none" };

const admin = (fullName: string): ZeropsOrganizationMember => ({
  id: `m-${fullName}`,
  roleCode: "ADMIN",
  status: "ACTIVE",
  user: { fullName },
});

const gate = (
  roleCode: string | undefined,
  hq: OfficialHq,
  status: "idle" | "loading" | "ready" | "failed" = "ready",
  options: {
    readonly pathname?: string;
    readonly admins?: ReadonlyArray<ZeropsOrganizationMember>;
  } = {},
) =>
  resolveHqGate({
    organization: { id: "org-1" },
    membership: { roleCode, canCreateProjects: false },
    accountHq: { status, hq, admins: options.admins ?? [] },
    pathname: options.pathname ?? "/zerops",
  });

describe("resolveHqGate", () => {
  it.each([
    ["an owner", "OWNER"],
    ["an admin", "ADMIN"],
    ["a developer", "BASIC_USER"],
  ])("opens the product over an official HQ for %s", (_who, roleCode) => {
    expect(gate(roleCode, OFFICIAL)).toEqual({ kind: "open" });
  });

  it("opens it over the HQ the member list named last, while the list is read again", () => {
    expect(gate("BASIC_USER", OFFICIAL, "loading")).toEqual({ kind: "open" });
  });

  it.each([
    ["an owner", "OWNER"],
    ["an admin", "ADMIN"],
  ])("has %s's first visit of an organization without HQ bear it", (_who, roleCode) => {
    expect(gate(roleCode, NONE)).toEqual({ kind: "birth" });
  });

  it("shows anybody else whom to ask, and nothing more", () => {
    expect(gate("BASIC_USER", NONE, "ready", { admins: [admin("Ada"), admin("Jan")] })).toEqual({
      kind: "ask",
      line: "An admin sets up Mate for this organization. Ask Ada or Jan.",
    });
    expect(gate("READ_ONLY", NONE)).toEqual({
      kind: "ask",
      line: "An admin sets up Mate for this organization. Ask an owner or admin of the organization.",
    });
  });

  it("never has a person the session does not name bear HQ: unknown is no", () => {
    expect(
      resolveHqGate({
        organization: { id: "org-1" },
        membership: undefined,
        accountHq: { status: "ready", hq: NONE, admins: [] },
        pathname: "/zerops",
      }),
    ).toMatchObject({ kind: "ask" });
  });

  it("waits for the member list before it says anything of HQ", () => {
    expect(gate("OWNER", NONE, "loading")).toEqual({ kind: "reading", failed: false });
    expect(gate("OWNER", NONE, "idle")).toEqual({ kind: "reading", failed: false });
    expect(gate("OWNER", NONE, "failed")).toEqual({ kind: "reading", failed: true });
  });

  it("opens nothing over two HQs, for anybody", () => {
    const unclear: OfficialHq = { kind: "unclear", projectIds: ["hq1", "hq2"] };
    expect(gate("OWNER", unclear)).toEqual({ kind: "unclear", line: HQ_UNCLEAR });
    expect(gate("BASIC_USER", unclear)).toEqual({ kind: "unclear", line: HQ_UNCLEAR });
  });

  it("stands in the way of nothing before an organization is chosen, or in settings", () => {
    expect(
      resolveHqGate({
        organization: null,
        membership: undefined,
        accountHq: { status: "idle", hq: NONE, admins: [] },
        pathname: "/zerops",
      }),
    ).toEqual({ kind: "open" });
    expect(gate("BASIC_USER", NONE, "ready", { pathname: "/settings/zerops" })).toEqual({
      kind: "open",
    });
  });
});
