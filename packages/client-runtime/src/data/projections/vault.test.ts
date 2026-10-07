import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { projectVariablesFamily, projectVariablesScope } from "../families/projectVariables.ts";
import { serviceVariableFamily, serviceVariablesScope } from "../families/serviceVariables.ts";
import { emptyAccount, type AccountState, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { vault } from "./vault.ts";
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

/** A demanded vault scope answered once: its rows decoded as the adapter decodes them. */
function answered(
  scope: ScopeKey,
  family: "projectVariables" | "serviceVariable",
  items: ReadonlyArray<unknown>,
  partial = false,
): ReadonlyArray<AccountInput> {
  const decode = (family === "projectVariables" ? projectVariablesFamily : serviceVariableFamily)
    .zeropsQuery!.decode;
  const rows = items.flatMap((item): Row[] => {
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
  });
  return [
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
      partial,
    },
    event(scope, { kind: "baseline-committed" }),
  ];
}

const refused = (scope: ScopeKey): AccountInput =>
  event(scope, {
    kind: "fault",
    fault: { outcome: "definitive-refusal", message: "no" },
    jitter: 0,
  });

const viewOf = (...inputs: ReadonlyArray<ReadonlyArray<AccountInput>>): VaultView => {
  const state = inputs
    .flat()
    .reduce<AccountState>((current, input) => reduceAccount(current, input).state, emptyAccount);
  return vault.derive(readsOfState(state), { orgId: ORG, projectId: PROJECT });
};

const base = liveZerops({ running: PROCESSES, services: SERVICES });
const sharedAnswer = answered(SHARED_SCOPE, "projectVariables", [
  { id: PROJECT, envList: SHARED_ROWS },
]);
const servicesAnswer = answered(SERVICES_SCOPE, "serviceVariable", SERVICE_ROWS);
const ready = viewOf(base, sharedAnswer, servicesAnswer);

const scope = (view: VaultView, id: string) => view.scopes.find((each) => each.id === id)!;
const value = (view: VaultView, id: string, key: string) =>
  scope(view, id).values.find((each) => each.key === key)!;

describe("vault", () => {
  it.each([
    { name: "nothing answered", view: () => viewOf(base), status: "unread" },
    { name: "Shared alone answered", view: () => viewOf(base, sharedAnswer), status: "unread" },
    { name: "both answered", view: () => ready, status: "ready" },
    {
      name: "a read refused, though both answered once",
      view: () => viewOf(base, sharedAnswer, servicesAnswer, [refused(SERVICES_SCOPE)]),
      status: "failed",
    },
    {
      name: "a read refused before any answer",
      view: () =>
        viewOf(base, [
          event(SHARED_SCOPE, { kind: "demand", demanded: true }),
          refused(SHARED_SCOPE),
        ]),
      status: "failed",
    },
  ])("is $status with $name", ({ view, status }) => {
    expect(view().status).toBe(status);
  });

  it("keeps what an earlier answer said once a read fails", () => {
    const failed = viewOf(base, sharedAnswer, servicesAnswer, [refused(SERVICES_SCOPE)]);
    expect(failed.scopes).toEqual(ready.scopes);
  });

  it("lists Shared, then the runtimes, then the managed services by hostname — never zcp or a build container", () => {
    expect(
      ready.scopes.map(({ id, hostname, kind, editable, serviceType }) => ({
        id,
        hostname,
        kind,
        editable,
        serviceType,
      })),
    ).toEqual([
      { id: "shared", hostname: null, kind: "shared", editable: true, serviceType: null },
      {
        id: "s-app",
        hostname: "appdev",
        kind: "runtime",
        editable: true,
        serviceType: "nodejs@22",
      },
      {
        id: "s-stage",
        hostname: "appstage",
        kind: "runtime",
        editable: true,
        serviceType: "nodejs@22",
      },
      {
        id: "s-db",
        hostname: "db",
        kind: "managed",
        editable: false,
        serviceType: "postgresql@17",
      },
    ]);
  });

  it.each([
    { id: "shared", keys: ["LOG_LEVEL", "OLD_FLAG", "STRIPE_KEY"] },
    { id: "s-app", keys: ["API_TOKEN"] },
    { id: "s-stage", keys: [] },
    { id: "s-db", keys: ["password", "user"] },
  ])(
    "holds the person's values, or the ones Zerops made for a managed one: $id",
    ({ id, keys }) => {
      expect(scope(ready, id).values.map((each) => each.key)).toEqual(keys);
    },
  );

  it("never holds a sensitive value, and marks a managed one's as made by Zerops", () => {
    expect(value(ready, "shared", "STRIPE_KEY")).toMatchObject({ sensitive: true, value: null });
    expect(value(ready, "shared", "LOG_LEVEL")).toMatchObject({
      value: "info",
      madeByZerops: false,
    });
    expect(value(ready, "s-db", "password")).toMatchObject({ value: null, madeByZerops: true });
  });

  it("reads a runtime's deployed entries and where each reference resolves", () => {
    expect(scope(ready, "s-app").reads).toEqual([
      {
        key: "DB_PASS",
        template: "${db_password}",
        refs: [
          {
            kind: "value",
            name: "db_password",
            scope: { kind: "service", serviceId: "s-db" },
            key: "password",
          },
        ],
      },
      { key: "GONE", template: "${NOPE}", refs: [{ kind: "missing", name: "NOPE" }] },
      { key: "HOST", template: "${hostname}", refs: [{ kind: "platform", name: "hostname" }] },
      {
        key: "LOG",
        template: "${LOG_LEVEL}",
        refs: [{ kind: "value", name: "LOG_LEVEL", scope: { kind: "shared" }, key: "LOG_LEVEL" }],
      },
      { key: "SELF", template: "${SELF}", refs: [{ kind: "self", name: "SELF" }] },
      {
        key: "TOKEN",
        template: "${API_TOKEN}",
        refs: [
          {
            kind: "value",
            name: "API_TOKEN",
            scope: { kind: "service", serviceId: "s-app" },
            key: "API_TOKEN",
          },
        ],
      },
    ]);
  });

  it("says when each runtime last started: its newest finished deploy, start or restart", () => {
    expect(scope(ready, "s-app").startedAt).toBe(T(10));
    expect(scope(ready, "s-stage").startedAt).toBe(T(12));
    expect(scope(ready, "s-db").startedAt).toBeNull();
  });

  it("says who reads a value and whether each runs it", () => {
    expect(value(ready, "shared", "LOG_LEVEL").readers).toEqual([
      { serviceId: "s-app", hostname: "appdev", via: ["LOG"], state: "restart" },
      { serviceId: "s-stage", hostname: "appstage", via: ["LOG"], state: "live" },
    ]);
    expect(value(ready, "s-db", "password").readers).toEqual([
      { serviceId: "s-app", hostname: "appdev", via: ["DB_PASS"], state: "live" },
    ]);
  });

  it("lists what is not live: restarts by service, literal references, values nothing reads yet", () => {
    expect(ready.notLive).toEqual([
      { kind: "restart", serviceId: "s-app", hostname: "appdev", keys: ["LOG_LEVEL"] },
      { kind: "missing", serviceId: "s-app", hostname: "appdev", entry: "GONE", name: "NOPE" },
      { kind: "self", serviceId: "s-app", hostname: "appdev", entry: "SELF" },
      // OLD_FLAG was written before the newest deploy: not waiting for one.
      { kind: "unread", scope: { kind: "shared" }, key: "STRIPE_KEY" },
    ]);
  });

  it("calls every value nothing reads unread while no deploy is known", () => {
    const view = viewOf(
      liveZerops({ running: [], services: SERVICES }),
      sharedAnswer,
      servicesAnswer,
    );
    expect(view.notLive.filter((each) => each.kind === "unread")).toEqual([
      { kind: "unread", scope: { kind: "shared" }, key: "OLD_FLAG" },
      { kind: "unread", scope: { kind: "shared" }, key: "STRIPE_KEY" },
    ]);
  });

  it("claims nothing from an absence while an answer is partial", () => {
    const view = viewOf(
      base,
      sharedAnswer,
      answered(SERVICES_SCOPE, "serviceVariable", [...SERVICE_ROWS, { id: "damaged" }], true),
    );
    expect(view.notLive.map((each) => each.kind)).toEqual(["restart", "self"]);
  });
});
