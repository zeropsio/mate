import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";

import { projectThreadAwareness } from "./agentAwareness.ts";
import { hqOffer } from "./hqOffers.ts";
import { KeyLinkDown, readLinkUp } from "./mateLink.ts";
import { THEME_COLOR_ROLES, ZEROPS_THEME, type ThemeColorRole } from "./themePalettes.ts";
import { contrastRatio, parseThemeColor } from "./themePreview.ts";
import { kindForAwarenessPhase, resolveThreadStatus, toneIdForKind } from "./threadStatus.ts";
import { threadStatusVectors } from "./threadStatus.vectors.ts";
import {
  addMatePermission,
  appPermission,
  attachPermission,
  changePermission,
  createAppPermission,
  deployPermission,
  detachPermission,
  mateRecordPermission,
  operateMatePermission,
  releasePermission,
  structurePermission,
  type Decision,
  type PermissionFacts,
} from "./zeropsPermissions.ts";
import {
  PROJECT_COLUMNS,
  ROLE_ROWS,
  STATUS_ROWS,
  VECTOR_PROJECT_ID,
  VECTOR_USER_ID,
  permissionVectors,
  roleAnswerVectors,
  type PermissionCall,
} from "./zeropsPermissions.vectors.ts";
import { organizationOffers, placementOffers } from "./zeropsOffers.ts";
import { mayCreateProjects, projectReach, zeropsRoleAnswer } from "./zeropsRoles.ts";

const AT = "2026-10-03T10:00:00.000Z";

/** A Mate's whole overview, every section in it: its main chat waits on a question. */
const overview = {
  identity: { environmentId: "env-ada", serverVersion: "0.11.90", update: null },
  main: {
    id: "t1",
    title: "Add a login page",
    hasPendingApprovals: false,
    hasPendingUserInput: true,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    backgroundLiveness: null,
    session: { status: "ready", lastError: null },
    latestTurn: {
      turnId: "turn-1",
      state: "completed",
      requestedAt: AT,
      startedAt: AT,
      completedAt: AT,
    },
    latestUserMessageAt: AT,
    updatedAt: AT,
    latestUserMessagePreview: { text: "Add a login page" },
    latestMessagePreview: { role: "assistant", text: "Which provider should it use?" },
    planProgress: null,
    pendingQuestion: "Which provider should it use?",
    usagePause: null,
    liveStep: {
      kind: "calls",
      since: AT,
      calls: [
        {
          id: "call-1",
          activityKind: "tool.updated",
          itemType: "command_execution",
          title: "Command run",
          detail: "Bash: pnpm build",
          toolName: "Bash",
          command: "pnpm build",
          startedAt: AT,
        },
      ],
    },
  },
  threads: {
    list: [
      {
        id: "t1",
        title: "Add a login page",
        kind: "input",
        turnId: "turn-1",
        turnState: "completed",
        completedAt: AT,
      },
    ],
    omitted: 3,
  },
  logins: { "claude-code": { signedInBy: "U1", present: true, token: false } },
  crew: {
    status: "applied",
    crewmates: [
      {
        handle: "fen",
        displayName: "Fen",
        tint: "teal",
        lead: true,
        threadId: "t9",
        threadKind: "working",
        loginKey: "claude-code",
      },
    ],
    attention: [{ id: "question:a1", kind: "question", handle: "fen" }],
    readyTasks: [{ id: "task-1", owner: "fen" }],
    personLands: true,
  },
};

/** HQ's state of a Mate, as this build's HQ sends it. */
const mate = {
  projectId: "P_MATE",
  name: "Ada",
  face: "face-1",
  standupRequestedBy: null,
  chief: null,
  appId: "A1",
  appName: "Shop",
  changes: [
    {
      repo: "appdev",
      number: 7,
      title: "Add a login page",
      state: "merged",
      head: "a".repeat(40),
      mergedSha: "b".repeat(40),
      landedHead: "a".repeat(40),
    },
  ],
};

const decodeDown = Schema.decodeUnknownExit(Schema.fromJsonString(KeyLinkDown));

// witness: packages/shared/src/mateLink.ts | if (!UP_TYPES.has(type)) return { kind: "unknown", type }; → if (!UP_TYPES.has(type)) return INVALID;
it("SH1: A link frame from a newer HQ or Mate is read by the keys this build knows, a frame of an unknown type is passed by, and a known type whose body does not decode is refused", () => {
  // A newer Mate's overview: its keys this build does not know are passed by, the rest read.
  const newer = {
    ...overview,
    identity: { ...overview.identity, later: { protocol: 9 } },
    laterSection: [{ id: "x" }],
  };
  expect(readLinkUp(JSON.stringify({ type: "overview", full: true, overview: newer }))).toEqual({
    kind: "message",
    message: { type: "overview", full: true, overview },
  });
  // A newer HQ's state of the Mate, read the same way down the link.
  const state = decodeDown(
    JSON.stringify({
      type: "state",
      mate: { ...mate, releases: [] },
      admission: "admission",
      laterExtra: 1,
    }),
  );
  expect(state._tag === "Success" ? state.value : state._tag).toEqual({
    type: "state",
    mate,
    admission: "admission",
  });

  // A frame of a type this build does not know is passed by, the link kept.
  expect(readLinkUp(JSON.stringify({ type: "later-frame", windows: [] }))).toEqual({
    kind: "unknown",
    type: "later-frame",
  });

  // A known type whose body does not decode is refused, up and down.
  const long = { ...overview, main: { ...overview.main, title: "x".repeat(121) } };
  const { crew: _crew, ...partial } = overview;
  for (const frame of [
    JSON.stringify({ type: "overview", full: true, overview: long }),
    JSON.stringify({ type: "overview", full: true, overview: partial }),
    JSON.stringify({ type: "overview", full: false, overview }),
    JSON.stringify({ kind: "overview" }),
    JSON.stringify(["pong"]),
    "not a frame",
  ]) {
    expect(readLinkUp(frame), frame.slice(0, 60)).toEqual({ kind: "invalid" });
  }
  const broken = decodeDown(
    JSON.stringify({ type: "state", mate: { ...mate, changes: [{ repo: "appdev" }] } }),
  );
  expect(broken._tag).toBe("Failure");
});

// witness: packages/shared/src/zeropsRoles.ts | roleAtLeast(member.roleCode, "ADMIN") || member.canCreateProjects === true → member.canCreateProjects === true
it("SH2: Projects may be created by Zerops' own flag on the account or by an owner's or admin's role, and by no other role", () => {
  const roles = ["OWNER", "ADMIN", "BASIC_USER", "READ_ONLY", "NO_ACCESS", "SUPERUSER"];
  for (const roleCode of roles)
    for (const canCreateProjects of [false, true])
      for (const status of ["ACTIVE", "INVITED"]) {
        const creates =
          status === "ACTIVE" &&
          (roleCode === "OWNER" || roleCode === "ADMIN" || canCreateProjects);
        expect(
          mayCreateProjects({ roleCode, status, canCreateProjects }),
          `${roleCode}, flag ${canCreateProjects}, ${status}`,
        ).toBe(creates);
      }
});

// witness: packages/shared/src/zeropsRoles.ts | OWNER: "administer", → OWNER: "work",
it("SH5: A role reaches a project as none, read, work or administer: an owner as far as an admin, and a role this build does not know, or none at all, reaches nothing", () => {
  const table = [
    ["OWNER", "administer"],
    ["ADMIN", "administer"],
    ["BASIC_USER", "work"],
    ["READ_ONLY", "read"],
    ["NO_ACCESS", "none"],
    ["SUPERUSER", "none"],
    [undefined, "none"],
  ] as const;
  for (const [role, reach] of table) expect(projectReach(role), String(role)).toBe(reach);
});

/** A vectors grid: its header, and each `<role> <status>` row's remaining cells. */
function readGrid(grid: string) {
  const [header = [], ...rows] = grid
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/u));
  return {
    header,
    rows: new Map(rows.map(([role, status, ...cells]) => [`${role} ${status}`, cells])),
  };
}

const gridRows = ROLE_ROWS.flatMap((role) => STATUS_ROWS.map((status) => [role, status] as const));

function decide(call: PermissionCall, facts: PermissionFacts): Decision {
  switch (call.fn) {
    case "createAppPermission":
      return createAppPermission(facts);
    case "appPermission":
      return appPermission(facts, call.verb, call.projectIds);
    case "structurePermission":
      return structurePermission(facts);
    case "addMatePermission":
      return addMatePermission(facts, call.projectIds);
    case "operateMatePermission":
      return operateMatePermission(facts, call.projectId);
    case "mateRecordPermission":
      return mateRecordPermission(facts, call.projectId, call);
    case "attachPermission":
      return attachPermission(facts, call.target);
    case "changePermission":
      return changePermission(facts, call.verb, call.projectIds, call.mergers);
    case "deployPermission":
      return deployPermission(facts, call.verb, call.projectId, call.productionMergers);
    case "releasePermission":
      return releasePermission(facts, call.projectIds, call.production, call.mergers);
    case "detachPermission":
      return detachPermission(facts, call.projectId, call.held);
  }
}

// witness: packages/shared/src/zeropsPermissions.ts | if (!administers(roleOn(facts, member, projectId))) return refuse("not_project_admin"); → if (administers(roleOn(facts, member, projectId))) return refuse("not_project_admin");
it("SH6: Every verb the rule decides answers each organization role, project override, membership status and listed or gone project as the vectors HQ's twin replays say, so the client never offers what HQ refuses", () => {
  for (const vector of permissionVectors) {
    const { header, rows } = readGrid(vector.grid);
    expect(header, vector.name).toEqual(["role", "status", ...PROJECT_COLUMNS]);
    expect([...rows.keys()], vector.name).toEqual(gridRows.map((row) => row.join(" ")));
    for (const [roleCode, status] of gridRows) {
      const answered = PROJECT_COLUMNS.map((column) => {
        const decision = decide(vector.call, {
          member: {
            userId: VECTOR_USER_ID,
            roleCode,
            status,
            canCreateProjects: vector.canCreateProjects,
          },
          project: (id) =>
            id !== VECTOR_PROJECT_ID || column === "gone"
              ? undefined
              : column === "none"
                ? {}
                : { override: column },
        });
        return decision.allow ? "allow" : decision.reason;
      });
      expect(answered, `${vector.name}: ${roleCode} ${status}`).toEqual(
        rows.get(`${roleCode} ${status}`),
      );
    }
  }
});

// witness: packages/shared/src/zeropsRoles.ts | : "hidden"; → : "listed";
it("SH7: The role function opens a Mate from Basic user up, lists it to a read-only person and hides it below that or from anyone not an active member, by the project's override over the organization role, and names no other project as a Mate", () => {
  for (const vector of roleAnswerVectors) {
    const { header, rows } = readGrid(vector.grid);
    expect(header, vector.name).toEqual([
      "role",
      "status",
      "active",
      "canCreate",
      ...PROJECT_COLUMNS,
    ]);
    expect([...rows.keys()], vector.name).toEqual(gridRows.map((row) => row.join(" ")));
    for (const [orgRole, status] of gridRows) {
      const answers = PROJECT_COLUMNS.map((column) =>
        zeropsRoleAnswer({
          person: {
            id: VECTOR_USER_ID,
            orgRole,
            status,
            canCreateProjects: vector.canCreateProjects,
          },
          overrides: column === "gone" || column === "none" ? {} : { [VECTOR_PROJECT_ID]: column },
          registry: {
            groups: [
              {
                id: "G",
                projects: column === "gone" ? [] : [{ id: VECTOR_PROJECT_ID, kind: vector.kind }],
              },
            ],
          },
        }),
      );
      const [active, canCreate, ...cells] = rows.get(`${orgRole} ${status}`) ?? [];
      expect(answers, `${vector.name}: ${orgRole} ${status}`).toEqual(
        cells.map((cell) => ({
          active: active === "true",
          canCreate: canCreate === "true",
          mates: cell === "absent" ? {} : { [VECTOR_PROJECT_ID]: cell },
        })),
      );
    }
  }
});

// witness: packages/shared/src/zeropsOffers.ts | stop_task: structure, → stop_task: createAppPermission(facts),
it("SH8: Setting the automated Mates' key, stopping a task and making the GitHub app for a repository's origin are offered to an active owner or admin, refused to any other role, one who may create projects included, or to a member not active, and neither while the membership is not read", () => {
  const verbs = ["add_automated_mate", "stop_task", "origin_remote"];
  // role, status, its answer once the membership is read; a row without a role is no member row.
  const table = [
    ["OWNER", "ACTIVE", "allowed"],
    ["OWNER", "INVITED", "not_active_member"],
    ["ADMIN", "ACTIVE", "allowed"],
    ["ADMIN", "INVITED", "not_active_member"],
    ["BASIC_USER", "ACTIVE", "not_structure_writer"],
    ["BASIC_USER", "INVITED", "not_active_member"],
    ["READ_ONLY", "ACTIVE", "not_structure_writer"],
    ["READ_ONLY", "INVITED", "not_active_member"],
    ["NO_ACCESS", "ACTIVE", "not_structure_writer"],
    ["NO_ACCESS", "INVITED", "not_active_member"],
    [undefined, undefined, "not_active_member"],
  ] as const;
  for (const [roleCode, status, known] of table)
    for (const membership of ["known", "unread"] as const) {
      const facts: PermissionFacts = {
        member: roleCode === undefined ? undefined : { roleCode, status, canCreateProjects: true },
        project: () => undefined,
      };
      // Not read: the organization carries no `can` record (`decided`), so nothing is said.
      const can = membership === "known" ? organizationOffers(facts) : undefined;
      const expected =
        membership === "unread"
          ? { kind: "unknown" }
          : known === "allowed"
            ? { kind: "allowed" }
            : { kind: "refused", reason: known };
      for (const verb of verbs)
        expect(hqOffer(can, verb), `${roleCode} ${status} ${membership}: ${verb}`).toEqual(
          expected,
        );
    }
});

// witness: packages/shared/src/threadStatus.ts | if (thread.hasPendingUserInput) return status("input"); → if (thread.hasPendingUserInput) return status("approval");
it("SH3: Every thread status resolves to one phrase through the one resolver, the same for the web row, the palette pill, the mobile row, the widget and the relay", () => {
  for (const vector of threadStatusVectors) {
    // The rows and the palette read the resolver's own answer.
    const status = resolveThreadStatus(vector.input);
    expect(status, vector.name).toEqual(vector.expected);

    // The widget and the relay read the awareness the same resolver projects, and its phase
    // comes back to the resolver's kind and tone: a finished run reads as done.
    const awareness = projectThreadAwareness({
      environmentId: EnvironmentId.make("env-1"),
      project: { title: "Shop" },
      thread: {
        ...vector.input,
        id: ThreadId.make("thread-1"),
        title: "Fix failing CI",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        updatedAt: AT,
      },
    });
    expect(awareness?.phase ?? null, vector.name).toBe(vector.expectedAwarenessPhase);
    if (vector.expectedAwarenessPhase === null) continue;
    const kind = kindForAwarenessPhase(vector.expectedAwarenessPhase);
    expect(kind, vector.name).toBe(
      vector.expectedAwarenessPhase === "completed" ? "done" : status.kind,
    );
    expect(toneIdForKind(kind), vector.name).toBe(vector.expectedAwarenessToneId);
  }
});

/** Each named pair: ink on its ground, and the ratio it meets in both appearances. */
const contrastPairs = [
  ["text", "canvas", 4.5],
  ["text", "surface", 4.5],
  ["text", "surfaceRaised", 4.5],
  ["messageActionForeground", "messageAction", 4.5],
  ["messageActionForeground", "error", 4.5],
  ["accentForeground", "accent", 4.5],
  ["accentSurfaceForeground", "accentSurface", 4.5],
  ["errorForeground", "errorSurface", 4.5],
  ["warningForeground", "warningSurface", 4.5],
  ["updateForeground", "updateSurface", 4.5],
  ["messageForeground", "messageSurface", 4.5],
  ["secondaryForeground", "secondary", 4.5],
  ["mutedForeground", "muted", 4.5],
  ["toolbarForeground", "toolbar", 4.5],
  ["toolbarControlForeground", "toolbarControl", 4.5],
  ["sidebarForeground", "sidebar", 4.5],
  ["sidebarMutedForeground", "sidebar", 4.5],
  ["codeForeground", "codeBackground", 4.5],
  ["terminalForeground", "terminalBackground", 4.5],
  ["textMuted", "canvas", 4.5],
  ["textMuted", "surface", 4.5],
  ["secondaryLabel", "canvas", 4.5],
  ["secondaryLabel", "surface", 4.5],
  ["focus", "canvas", 3],
  ["terminalCursor", "terminalBackground", 3],
] as const satisfies ReadonlyArray<readonly [ThemeColorRole, ThemeColorRole, number]>;

// witness: packages/shared/src/themePalettes.ts | text: "oklch(0.217787 0 0)", → text: "oklch(0.7 0 0)",
it("SH4: The theme defines every colour role in both appearances at full alpha, and each named contrast pair meets its ratio", () => {
  const light = ZEROPS_THEME.colors;
  const dark = ZEROPS_THEME.variants?.dark;
  expect(dark).toBeDefined();
  for (const [appearance, colors] of [
    ["light", light],
    ["dark", dark ?? light],
  ] as const) {
    expect(Object.keys(colors), appearance).toEqual(THEME_COLOR_ROLES);
    for (const [role, value] of Object.entries(colors))
      expect(parseThemeColor(value)?.alpha, `${appearance}/${role}`).toBe(1);
    for (const [ink, ground, ratio] of contrastPairs)
      expect(
        contrastRatio(colors[ink], colors[ground]),
        `${appearance}/${ink}/${ground}`,
      ).toBeGreaterThanOrEqual(ratio);
  }
  // The light placeholder is read on its input; the dark one is the Zerops exclusion.
  expect(contrastRatio(light.placeholder, light.input)).toBeGreaterThanOrEqual(4.5);
});

// witness: packages/shared/src/zeropsPermissions.ts | return attachPermission(facts, { projectId, projectIds, kind: "mate", held, slotTaken: false }); → return adds;
it("SH9: Set up Mate on a held Mate is offered exactly to whom HQ's start admits: who may create projects and owns the project's attach, an owner or admin of the organization or an Admin grant on it; breaks: a Basic user presses it and HQ refuses, or an Admin has no way to set it up", () => {
  const table = [
    ["OWNER", false, undefined, "allowed"],
    ["ADMIN", true, undefined, "allowed"],
    ["BASIC_USER", false, undefined, "cannot_create_projects"],
    ["BASIC_USER", true, undefined, "not_own_new_mate"],
    ["BASIC_USER", true, "ADMIN", "allowed"],
  ] as const;
  for (const [roleCode, canCreateProjects, override, want] of table) {
    const facts: PermissionFacts = {
      member: { roleCode, status: "ACTIVE", canCreateProjects },
      project: (id) => (id === "p" ? (override === undefined ? {} : { override }) : undefined),
    };
    const can = placementOffers(facts, { projectId: "p", kind: "mate" }, { projectIds: ["p"] });
    const said = hqOffer(can, "set_up");
    expect([roleCode, override, said.kind === "refused" ? said.reason : said.kind]).toEqual([
      roleCode,
      override,
      want,
    ]);
  }
});
