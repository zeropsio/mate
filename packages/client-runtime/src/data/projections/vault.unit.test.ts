import { expect, it } from "vite-plus/test";

import { membershipInputs } from "../__fixtures__/membership.ts";
import { liveZerops, ORG, processValue } from "../__fixtures__/account.ts";
import { historyScope } from "../families/process.ts";
import { projectVariablesFamily, projectVariablesScope } from "../families/projectVariables.ts";
import { serviceVariableFamily, serviceVariablesScope } from "../families/serviceVariables.ts";
import { emptyAccount, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { vault } from "./vault.ts";
import { vaultChangesSince, vaultImpact, vaultNote, vaultRestarts } from "./vaultChanges.ts";
import type { VaultView } from "./vaultModel.ts";

const PROJECT = "p1";
const SHARED_SCOPE = projectVariablesScope(ORG, PROJECT);
const SERVICES_SCOPE = serviceVariablesScope(ORG, PROJECT);

const runtime = (id: string, name: string) => ({
  id,
  projectId: PROJECT,
  name,
  serviceStackTypeInfo: {
    serviceStackTypeCategory: "USER",
    serviceStackTypeVersionName: "ubuntu/nodejs@22",
  },
});
const SERVICES = [
  runtime("s-app", "appdev"),
  runtime("s-stage", "appstage"),
  {
    id: "s-db",
    projectId: PROJECT,
    name: "db",
    serviceStackTypeInfo: {
      serviceStackTypeCategory: "STANDARD",
      serviceStackTypeVersionName: "postgresql@17",
    },
  },
  {
    id: "s-zcp",
    projectId: PROJECT,
    name: "zcp",
    serviceStackTypeInfo: {
      serviceStackTypeCategory: "USER",
      serviceStackTypeVersionName: "zcp@1",
    },
  },
  {
    id: "s-build",
    projectId: PROJECT,
    name: "buildappdevv1790258582",
    status: "STOPPED",
    serviceStackTypeInfo: { serviceStackTypeCategory: "BUILD" },
  },
];

const T = (hour: number) => `2026-10-07T${String(hour).padStart(2, "0")}:00:00Z`;

/** Finished processes: appdev deployed at 10, appstage restarted at 12; the project's newest deploy at 10. */
const PROCESSES = [
  {
    id: "deploy",
    projectId: PROJECT,
    status: "FINISHED",
    actionName: "stack.build",
    serviceStackIds: ["s-app"],
    finished: T(10),
  },
  {
    id: "restart",
    projectId: PROJECT,
    status: "FINISHED",
    actionName: "stack.restart",
    serviceStackIds: ["s-stage"],
    finished: T(12),
  },
  {
    id: "failed-restart",
    projectId: PROJECT,
    status: "FAILED",
    actionName: "stack.restart",
    serviceStackIds: ["s-app"],
    finished: T(14),
  },
  {
    id: "variables",
    projectId: PROJECT,
    status: "FINISHED",
    actionName: "stack.updateUserData",
    serviceStackIds: ["s-app"],
    finished: T(15),
  },
];

let rowId = 0;
const env = (
  key: string,
  content: string | null,
  patch: Readonly<Record<string, unknown>> = {},
) => ({
  id: `e-${(rowId += 1)}`,
  key,
  content,
  type: "USER",
  editable: true,
  sensitive: false,
  created: T(8),
  lastUpdate: T(8),
  ...patch,
});
const userData = (
  serviceStackId: string,
  key: string,
  content: string | null,
  patch: Readonly<Record<string, unknown>> = {},
) => ({ ...env(key, content, patch), serviceStackId });
const entry = (serviceStackId: string, key: string, template: string) =>
  userData(serviceStackId, key, template, { editable: false });
const system = (serviceStackId: string, key: string, content: string | null, sensitive = false) =>
  userData(serviceStackId, key, content, { type: "SYSTEM", editable: false, sensitive });

const SHARED_ROWS = [
  env("LOG_LEVEL", "info", { lastUpdate: T(11) }),
  env("STRIPE_KEY", "REDACTED", { sensitive: true, created: T(11), lastUpdate: T(11) }),
  env("OLD_FLAG", "1"),
  env("zeropsSubdomainHost", "abc.zerops.app", { type: "SYSTEM", editable: false }),
];
const SERVICE_ROWS = [
  system("s-app", "hostname", "appdev"),
  system("s-app", "PATH", "/usr/bin"),
  userData("s-app", "API_TOKEN", null, { sensitive: true, lastUpdate: T(9) }),
  entry("s-app", "LOG", "${LOG_LEVEL}"),
  entry("s-app", "TOKEN", "${API_TOKEN}"),
  entry("s-app", "DB_PASS", "${db_password}"),
  entry("s-app", "SELF", "${SELF}"),
  entry("s-app", "GONE", "${NOPE}"),
  entry("s-app", "HOST", "${hostname}"),
  entry("s-stage", "LOG", "${LOG_LEVEL}"),
  system("s-db", "password", "REDACTED", true),
  system("s-db", "user", "db"),
  system("s-db", "projectId", PROJECT),
  system("s-db", "ZEROPS_DEBUG_X", "1"),
  system("s-zcp", "hostname", "zcp"),
  userData("s-zcp", "ZCP_SECRET", "plain"),
  system("s-build", "hostname", "build"),
];

const event = (key: string, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;

/** A demanded scope answered once with these rows, committed whole. */
const committed = (scope: ScopeKey, rows: ReadonlyArray<Row>): ReadonlyArray<AccountInput> => [
  event(scope, { kind: "demand", demanded: true }),
  event(scope, { kind: "attempt" }),
  event(scope, { kind: "handshake" }),
  { kind: "baseline-begin", scope, generation: 1 },
  {
    kind: "baseline-commit",
    scope,
    generation: 1,
    via: "zerops-realtime",
    members: rows.map((row) => row.id),
    rows,
  },
  event(scope, { kind: "baseline-committed" }),
];

/** A vault scope answered: its rows decoded as the adapter decodes them. */
const answered = (
  scope: ScopeKey,
  family: "projectVariables" | "serviceVariable",
  items: ReadonlyArray<unknown>,
): ReadonlyArray<AccountInput> => {
  const decode = (family === "projectVariables" ? projectVariablesFamily : serviceVariableFamily)
    .zeropsQuery!.decode;
  return committed(
    scope,
    items.flatMap((item): Row[] => {
      const row = decode(item);
      return row === null
        ? []
        : [
            {
              family,
              id: row.id,
              value: row.value,
              revision: { kind: "zerops", version: null },
            } as Row,
          ];
    }),
  );
};

const viewOf = (...inputs: ReadonlyArray<ReadonlyArray<AccountInput>>): VaultView => {
  const state = inputs
    .flat()
    .reduce<AccountState>((current, input) => reduceAccount(current, input).state, emptyAccount);
  return vault.derive(readsOfState(state), { orgId: ORG, projectId: PROJECT });
};

const base = [
  ...liveZerops({ running: [], projects: [{ id: PROJECT }], services: SERVICES }),
  ...membershipInputs("ADMIN"),
  ...committed(
    historyScope(ORG, PROJECT),
    PROCESSES.map((process): Row => ({
      family: "process",
      id: process.id,
      value: processValue(process),
      revision: { kind: "zerops", version: 1 },
    })),
  ),
];
const sharedAnswer = answered(SHARED_SCOPE, "projectVariables", [
  { id: PROJECT, envList: SHARED_ROWS },
]);
const servicesAnswer = answered(SERVICES_SCOPE, "serviceVariable", SERVICE_ROWS);

const valueOf = (view: VaultView, id: string, key: string) =>
  view.scopes.find((each) => each.id === id)!.values.find((each) => each.key === key)!;

// witness: packages/client-runtime/src/data/families/projectVariables.ts | const sensitive = row.sensitive === true; → const sensitive = row.sensitive === false;
it("PJ54: The vault never holds a sensitive value", () => {
  const ready = viewOf(base, sharedAnswer, servicesAnswer);
  expect(valueOf(ready, "shared", "STRIPE_KEY")).toMatchObject({ sensitive: true, value: null });
});

// witness: packages/client-runtime/src/data/projections/vault.ts | key === "GIT_TOKEN"; → key === "GITHUB_TOKEN";
it("PJ55: The vault never lists the Mate's own keys as a value", () => {
  const view = viewOf(
    base,
    answered(SHARED_SCOPE, "projectVariables", [
      {
        id: PROJECT,
        envList: [
          ...SHARED_ROWS,
          env("ZCP_API_KEY", "admin-token", { created: T(13), lastUpdate: T(13) }),
          env("GIT_TOKEN", "git-token", { created: T(13), lastUpdate: T(13) }),
          env("GITEA_URL", "https://gitea", { created: T(13), lastUpdate: T(13) }),
        ],
      },
    ]),
    answered(SERVICES_SCOPE, "serviceVariable", [
      ...SERVICE_ROWS,
      userData("s-app", "MATE_SETUP", "x", { created: T(13), lastUpdate: T(13) }),
      entry("s-app", "ADMIN", "${ZCP_API_KEY}"),
    ]),
  );
  const keys = view.scopes.flatMap((each) => each.values.map((one) => one.key));
  for (const key of ["ZCP_API_KEY", "GIT_TOKEN", "GITEA_URL", "MATE_SETUP"]) {
    expect(keys).not.toContain(key);
    expect(JSON.stringify(view.notLive)).not.toContain(key);
  }
});

// witness: packages/client-runtime/src/data/projections/vault.ts | editable: ref.kind === "runtime" && canOperate, → editable: ref.kind === "runtime",
it("PJ56: Vault editing follows the person's current permission on the target project after a signed-in downgrade", () => {
  const view = viewOf(base, sharedAnswer, servicesAnswer, membershipInputs("READ_ONLY", false, 2));
  expect(view.scopes.map(({ editable }) => editable)).toEqual([false, false, false, false, false]);
});

/** A value the person gave the Mate for itself, written after the project's newest deploy. */
const MATES_VALUE = userData("s-zcp", "TEST_ACCOUNTS", "REDACTED", {
  sensitive: true,
  created: T(13),
  lastUpdate: T(13),
});

// witness: packages/client-runtime/src/data/projections/vault.ts | notLive: notLiveOf(apps, deployedAt, whole, historyRead), → notLive: notLiveOf([...apps, ...mate], deployedAt, whole, historyRead),
it("PJ78: A value in a Mate's own vault is listed there and is never said to be unread or to wait on a restart", () => {
  // Read by no app and written after the newest deploy: an app's value would be unread.
  const view = viewOf(
    base,
    sharedAnswer,
    answered(SERVICES_SCOPE, "serviceVariable", [...SERVICE_ROWS, MATES_VALUE]),
  );
  expect(view.complete).toBe(true);
  expect(
    view.scopes
      .filter((each) => each.kind === "mate")
      .map(({ id, editable, values, reads }) => ({
        id,
        editable,
        keys: values.map((value) => value.key),
        reads,
      })),
  ).toEqual([{ id: "s-zcp", editable: true, keys: ["TEST_ACCOUNTS"], reads: [] }]);
  expect(JSON.stringify(view.notLive)).not.toContain("TEST_ACCOUNTS");
});

// witness: packages/client-runtime/src/data/projections/vaultChanges.ts | if (scope?.kind === "mate") return []; → if (scope?.kind === "managed") return [];
it("PJ79: A write to a Mate's own vault restarts no app, though an app's deploy config names that value", () => {
  const view = viewOf(
    base,
    sharedAnswer,
    answered(SERVICES_SCOPE, "serviceVariable", [
      ...SERVICE_ROWS,
      entry("s-app", "ACCOUNTS", "${zcp_TEST_ACCOUNTS}"),
    ]),
  );
  expect(
    vaultRestarts(view, [
      {
        scope: { kind: "service", serviceId: "s-zcp" },
        write: { kind: "add", key: "TEST_ACCOUNTS", value: "x", sensitive: true },
      },
    ]),
  ).toEqual({ restart: [], notRunning: [], deploying: [] });
});

// witness: packages/client-runtime/src/data/projections/vaultChanges.ts | if (change.impact.mateOnly === true) → if (change.impact.mateOnly === false)
it("PJ80: A change in a Mate's own vault is told as the Mate's alone, never as waiting on a reference, a deploy or a restart", () => {
  const view = viewOf(
    base,
    sharedAnswer,
    answered(SERVICES_SCOPE, "serviceVariable", [...SERVICE_ROWS, MATES_VALUE]),
  );
  const changes = vaultChangesSince(view, T(12), []);
  expect(changes.map(({ key, kind, impact }) => ({ key, kind, impact }))).toEqual([
    {
      key: "TEST_ACCOUNTS",
      kind: "added",
      impact: { restart: [], unread: false, literal: [], mateOnly: true },
    },
  ]);
  // What its agent hears names no container and no service that reads it, and nothing to do.
  const told = vaultNote(changes);
  expect(told).toContain("TEST_ACCOUNTS");
  expect(told).not.toMatch(/zcp|service|zerops\.yml|deploy|restart/u);
});

// witness: packages/client-runtime/src/data/projections/vaultChanges.ts | return isMates(view, ref) ? MATE_ONLY : asRead(view, impactOn(view, ref, write)); → return !isMates(view, ref) ? MATE_ONLY : asRead(view, impactOn(view, ref, write));
it("PJ82: A write to a Mate's own vault is done once saved: it is never said to be unread, to need a restart or to leave an app on literal text", () => {
  const view = viewOf(
    base,
    sharedAnswer,
    answered(SERVICES_SCOPE, "serviceVariable", [...SERVICE_ROWS, MATES_VALUE]),
  );
  const scope = { kind: "service", serviceId: "s-zcp" } as const;
  const { id } = valueOf(view, "s-zcp", "TEST_ACCOUNTS");
  const done = { restart: [], unread: false, literal: [], mateOnly: true };
  expect(
    vaultImpact(view, scope, { kind: "add", key: "NEW_KEY", value: "x", sensitive: true }),
  ).toEqual(done);
  expect(
    vaultImpact(view, scope, {
      kind: "update",
      id,
      key: "TEST_ACCOUNTS",
      value: "y",
      sensitive: true,
    }),
  ).toEqual(done);
  expect(vaultImpact(view, scope, { kind: "remove", id, key: "TEST_ACCOUNTS" })).toEqual(done);
});

// witness: packages/client-runtime/src/data/projections/vault.ts | isMateOwned(key) || (mates && isContainerOwned(key)); → isMateOwned(key) || (!mates && isContainerOwned(key));
it("PJ81: The Mate's own vault never lists the names Mate and zcp write on its container for themselves, and Shared and an app's vault list those same names", () => {
  const OWN = ["T3CODE_ZEROPS_HQ_ORIGIN", "VSCODE_PASSWORD", "POOL_LEASE_TOKEN"];
  const view = viewOf(
    base,
    answered(SHARED_SCOPE, "projectVariables", [
      { id: PROJECT, envList: OWN.map((key) => env(key, "x")) },
    ]),
    answered(SERVICES_SCOPE, "serviceVariable", [
      ...SERVICE_ROWS,
      MATES_VALUE,
      ...OWN.flatMap((key) => [userData("s-zcp", key, "x"), userData("s-stage", key, "x")]),
    ]),
  );
  const keysOf = (id: string) =>
    view.scopes.find((each) => each.id === id)!.values.map((value) => value.key);
  expect(keysOf("s-zcp")).toEqual(["TEST_ACCOUNTS"]);
  expect(keysOf("shared")).toEqual([...OWN].sort());
  expect(keysOf("s-stage")).toEqual([...OWN].sort());
});
