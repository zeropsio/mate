import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG, projectValue, zeropsVersion } from "../__fixtures__/account.ts";
import { projectsScope } from "../families/project.ts";
import { emptyAccount, linkKeys, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { listedProject, organizationProjects, type OrganizationProjects } from "./projects.ts";

const SCOPE = projectsScope(ORG);
const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: string, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;
const delta = (add: ReadonlyArray<string>, remove: ReadonlyArray<string>): AccountInput => ({
  kind: "membership",
  scope: SCOPE,
  generation: 1,
  delta: { add, remove },
});

const live = () =>
  apply(emptyAccount, liveZerops({ running: [], projects: [{ id: "a" }, { id: "b" }] }));
const names = (projects: OrganizationProjects) => projects.projects.map((project) => project.id);

describe("organizationProjects", () => {
  it.each<{
    readonly name: string;
    readonly state: () => AccountState;
    readonly expected: Partial<OrganizationProjects> & { readonly ids?: ReadonlyArray<string> };
  }>([
    {
      name: "nothing asked yet: unread, never empty",
      state: () => emptyAccount,
      expected: { read: "unread", ids: [], complete: false, live: false },
    },
    {
      name: "registered, its baseline not answered: reading",
      state: () =>
        apply(emptyAccount, [
          event(linkKeys.zerops(ORG), { kind: "demand", demanded: true }),
          event(SCOPE, { kind: "demand", demanded: true }),
          event(SCOPE, { kind: "attempt" }),
        ]),
      expected: { read: "reading", ids: [], complete: false },
    },
    {
      name: "baselined and live: the whole roster",
      state: live,
      expected: { read: "read", ids: ["a", "b"], complete: true, live: true, reconnecting: false },
    },
    {
      name: "a new member whose row is not read yet: partial",
      state: () => apply(live(), [delta(["c"], [])]),
      expected: { ids: ["a", "b"], complete: false },
    },
    {
      name: "a new project pushed: listed at once",
      state: () =>
        apply(live(), [
          delta(["c"], []),
          {
            kind: "rows",
            scope: SCOPE,
            generation: 1,
            method: "push",
            via: "zerops-realtime",
            rows: [
              {
                family: "project",
                id: "c",
                value: projectValue({ id: "c" }),
                revision: zeropsVersion(1),
              },
            ],
          },
        ]),
      expected: { ids: ["a", "b", "c"], complete: true },
    },
    {
      name: "left the roster, not yet proven gone: kept, partial",
      state: () => apply(live(), [delta([], ["a"])]),
      expected: { ids: ["a", "b"], complete: false },
    },
    {
      name: "proven deleted: gone",
      state: () =>
        apply(live(), [
          delta([], ["a"]),
          { kind: "proven-deletion", family: "project", id: "a", evidence: "GET 404" },
        ]),
      expected: { ids: ["b"], complete: true },
    },
    {
      name: "taken from the viewer: withheld, never claimed deleted",
      state: () =>
        apply(live(), [
          delta([], ["a"]),
          { kind: "access", family: "project", id: "a", access: "denied" },
        ]),
      expected: { ids: ["b"], complete: true },
    },
    {
      name: "an outage: what was read stays, catching up",
      state: () =>
        apply(live(), [
          event(SCOPE, { kind: "parent-lost" }),
          event(linkKeys.zerops(ORG), {
            kind: "fault",
            jitter: 0,
            fault: { outcome: "transient", message: "socket closed" },
          }),
        ]),
      expected: { read: "read", ids: ["a", "b"], live: false, reconnecting: true },
    },
    {
      name: "refused: says why, keeps what was read",
      state: () =>
        apply(live(), [
          event(linkKeys.zerops(ORG), {
            kind: "fault",
            jitter: 0,
            fault: { outcome: "authoritative-denial", message: "HTTP 403" },
          }),
        ]),
      expected: { ids: ["a", "b"], reconnecting: false, unavailableReason: "forbidden" },
    },
  ])("$name", ({ state, expected }) => {
    const { ids, ...rest } = expected;
    const projects = organizationProjects.derive(readsOfState(state()), ORG);
    expect(projects).toMatchObject(rest);
    if (ids !== undefined) expect(names(projects)).toEqual(ids);
  });
});

describe("listedProject", () => {
  it.each<{
    readonly name: string;
    readonly state: () => AccountState;
    readonly id: string | null;
  }>([
    { name: "listed: its row", state: live, id: "a" },
    { name: "never read: nothing", state: () => emptyAccount, id: null },
    {
      name: "proven deleted: nothing",
      state: () =>
        apply(live(), [{ kind: "proven-deletion", family: "project", id: "a", evidence: "404" }]),
      id: null,
    },
    {
      name: "withheld: nothing",
      state: () =>
        apply(live(), [{ kind: "access", family: "project", id: "a", access: "denied" }]),
      id: null,
    },
  ])("$name", ({ state, id }) => {
    expect(
      listedProject.derive(readsOfState(state()), { orgId: ORG, projectId: "a" })?.id ?? null,
    ).toBe(id);
  });
});
