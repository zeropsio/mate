import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";

import { projectThreadAwareness } from "./agentAwareness.ts";
import {
  crewTints,
  parseCrewHome,
  renderCrewHome,
  validateCrewTopology,
  unplacedBuilders,
  withBuildersPlaced,
} from "./crewHome.ts";
import { crewFromAsk } from "./crewTemplates.ts";
import { hqOffer } from "./hqOffers.ts";
import { leaseMayBeOf } from "./hqChanges.ts";
import { KeyLinkDown, readLinkUp } from "./mateLink.ts";
import { standsInForSignIn } from "./openCodeKeyProviders.ts";
import { conversationOfBranch, type ZeropsConversationCandidate } from "./primaryConversation.ts";
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
  deleteProjectPermission,
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
  type PermissionCall,
} from "./zeropsPermissions.vectors.ts";
import { organizationOffers, placementOffers } from "./zeropsOffers.ts";
import { mayCreateProjects, projectReach } from "./zeropsRoles.ts";

const AT = "2026-10-03T10:00:00.000Z";

// witness: packages/shared/src/primaryConversation.ts | lease.branch === branch → true
it("SH10: Among a Mate's conversations a change's own is the chat bound to a lease of its branch in its repository, the more primary of two; a lease of another repository at the same HQ, another branch or no branch is not it", () => {
  const chat = { id: "chat", archivedAt: null, createdAt: AT, updatedAt: AT };
  const own = { appId: "app-a", repo: "repo" };
  const lease = { branch: "b", repo: "https://hq.example/git/org/app-a/repo.git" };
  const primary = { ...chat, id: "primary", pinnedAt: AT, lease };
  const table: ReadonlyArray<
    readonly [
      ReadonlyArray<
        ZeropsConversationCandidate & {
          readonly lease?: { readonly branch: string | null; readonly repo?: string } | null;
        }
      >,
      string | undefined,
    ]
  > = [
    [[{ ...chat, lease }], "chat"],
    [[{ ...chat, lease }, primary], "primary"],
    [[{ ...chat, lease: { branch: "b" } }], "chat"],
    [[{ ...chat, lease: { branch: "b", repo: "https://other.example/project.git" } }], "chat"],
    [
      [{ ...chat, lease: { branch: "b", repo: "https://hq.example/git/org/app-b/repo.git" } }],
      undefined,
    ],
    [
      [
        { ...chat, lease: { ...lease, branch: "other" } },
        { ...chat, id: "no-branch", lease: { ...lease, branch: null } },
      ],
      undefined,
    ],
    [
      [
        { ...chat, lease, crew: { crew: "crew", crewmate: "worker", stint: 1 } },
        { ...chat, id: "archived", archivedAt: AT, lease },
      ],
      undefined,
    ],
  ];
  for (const [threads, expected] of table)
    expect(conversationOfBranch(threads, "b", (repo) => leaseMayBeOf(repo, own))?.id).toBe(
      expected,
    );
});

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
    case "deleteProjectPermission":
      return deleteProjectPermission(facts, call.projectId);
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

// witness: packages/shared/src/zeropsOffers.ts | if (kind === "plain") return { delete_project: deleteProjectPermission(facts, projectId) }; → if (false) return { delete_project: deleteProjectPermission(facts, projectId) };
it("SH12: A Zerops project placed without a Mate offers exactly its deletion with its project, to an Admin of that Zerops project; breaks: the deletion page offers its switch to someone HQ then refuses, or withholds it from an Admin.", () => {
  const table: ReadonlyArray<readonly [string, string, string | undefined, boolean, Decision]> = [
    ["OWNER", "ACTIVE", undefined, true, { allow: true }],
    ["ADMIN", "ACTIVE", undefined, true, { allow: true }],
    ["BASIC_USER", "ACTIVE", "ADMIN", true, { allow: true }],
    ["BASIC_USER", "ACTIVE", undefined, true, { allow: false, reason: "not_project_admin" }],
    ["OWNER", "ACTIVE", undefined, false, { allow: false, reason: "project_gone" }],
    ["OWNER", "INACTIVE", undefined, true, { allow: false, reason: "not_active_member" }],
  ];
  for (const [roleCode, status, override, listed, decision] of table) {
    const facts: PermissionFacts = {
      member: { roleCode, status },
      project: (id) =>
        id === "p" && listed ? (override === undefined ? {} : { override }) : undefined,
    };
    expect(
      placementOffers(facts, { projectId: "p", kind: "plain" }, { projectIds: ["p"] }),
    ).toEqual({ delete_project: decision });
  }
});

// witness: packages/shared/src/openCodeKeyProviders.ts | (provider.driver !== "opencode" || → (true ||
it("SH11: OpenCode stands in for a person's sign-in only on a model key they set or once they chose it as the Mate's default model, never on its free models alone; breaks: a new Mate starts on a free model before its person signs in", () => {
  const ready = (driver: string, models: ReadonlyArray<string>) => ({
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    availability: "available" as const,
    status: "ready" as const,
    auth: { status: "authenticated" as const },
    models: models.map((slug) => ({ slug })),
  });
  const free = ready("opencode", ["opencode/beam-free", "opencode/big-pickle"]);
  const keyed = ready("opencode", ["opencode/beam-free", "nebius/some-model"]);
  const chosen = { instanceId: ProviderInstanceId.make("opencode") };
  const other = { instanceId: ProviderInstanceId.make("claudeAgent") };
  expect([
    standsInForSignIn(free, null),
    standsInForSignIn(free, other),
    standsInForSignIn(free, chosen),
    standsInForSignIn(keyed, null),
  ]).toEqual([false, false, true, true]);
});

// witness: packages/shared/src/crewHome.ts | unplaced(member) ? { ...member, ...only } : member → member
it("SH13: A crew drafted before the Mate's dev services are read keeps every crewmate, and its builder is placed on the only dev service, sharing the database it reaches, before Apply admits it; breaks: a crew card pressed on a Mate with a new dev service saves nobody, or a builder starts with nowhere for its copy", () => {
  const drafted = crewFromAsk({
    crew: "crew",
    devHosts: [],
    seats: [
      { name: "Lead", kind: "lead", part: "Plans the work." },
      { name: "Builder", kind: "writer", part: "Builds the app." },
      { name: "Reviewer", kind: "reader", part: "Reviews the work." },
    ],
  });
  const saved = parseCrewHome("crew", renderCrewHome(drafted));
  const read = saved.definition!;
  const project = { devHosts: ["appdev"], databaseHosts: ["appdev"] };
  const placed = withBuildersPlaced(read, project);
  expect({
    saved: saved.issues,
    unplaced: validateCrewTopology(read, project).map((issue) => [issue.code, issue.handle]),
    placed: placed.members.map((member) => [member.handle, member.host, member.database]),
    admitted: validateCrewTopology(placed, project),
  }).toEqual({
    saved: [],
    unplaced: [["host-missing", "builder"]],
    placed: [
      ["lead", undefined, undefined],
      ["builder", "appdev", "shared"],
      ["reviewer", undefined, undefined],
    ],
    admitted: [],
  });
});

// witness: packages/shared/src/crewHome.ts | if (places.devHosts.length + pools.length !== 1) return null; → if (places.devHosts.length + pools.length === 0) return null;
it("SH14: Among several dev services and dev pools a crew's builder is placed only where its crew card or the person named it, a named pool as a pool, and never by itself: it stays unplaced until the person picks; breaks: a builder starts on a service nobody chose, or a card's pool is taken for a service", () => {
  const places = { devHosts: ["appdev", "apidev"], pools: ["tinypool"] };
  const drafted = crewFromAsk({
    crew: "crew",
    ...places,
    seats: [
      { name: "Lead", kind: "lead", part: "Plans the work." },
      { name: "Api", kind: "writer", part: "Builds the API.", place: "apidev" },
      { name: "Pages", kind: "writer", part: "Builds the pages.", place: "tinypool" },
      { name: "Admin", kind: "writer", part: "Builds the admin." },
    ],
  });
  const placed = withBuildersPlaced(drafted, places);
  expect({
    placed: placed.members.map((member) => [member.handle, member.host, member.pool]),
    toPick: unplacedBuilders(placed).map((member) => member.handle),
  }).toEqual({
    placed: [
      ["lead", undefined, undefined],
      ["api", "apidev", undefined],
      ["pages", undefined, "tinypool"],
      ["admin", undefined, undefined],
    ],
    toPick: ["admin"],
  });
});

// witness: packages/shared/src/crewHome.ts | const worn = new Set(members.flatMap((member) => named(member.tint) ?? [])); → const worn = new Set<MateTintId>();
it("SH15: A crewmate its crew home gives no tint wears the first of the crew's tints no other crewmate wears, named or given before it, never its Mate's, in the crew's order, and one that names a tint keeps it; breaks: a hand-written crew's crewmates share a colour or their Mate's, or wear one in the top bar and another in the editor", () => {
  expect([
    ...crewTints(
      [{ handle: "lead" }, { handle: "builds", tint: "sky" }, { handle: "reviews", tint: null }],
      "violet",
    ),
  ]).toEqual([
    ["lead", "coral"],
    ["builds", "sky"],
    ["reviews", "olive"],
  ]);
});
