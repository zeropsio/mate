import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { HqBirthOffer, HqBirthOperation, type HqBirth } from "../../zerops/hq/client.ts";
import { recorded } from "../__fixtures__/recorded.ts";
import { liveZerops, ORG, processValue } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { membershipInputs } from "../__fixtures__/membership.ts";
import { makeAccountStore } from "../store.ts";
import { birthDeleteHeld, birthOffersFor, birthProgressOf, sharedBirths } from "./birthProgress.ts";
const plan = {
  projectName: "Shop - Ada",
  recipe: { kind: "none" },
  agents: ["codex"],
  standUp: false,
  automated: false,
  placement: { role: "dev", name: "Ada", chief: false },
  location: null,
  userRoles: [],
};
const failedAt = "2026-11-05T10:00:00.000Z";
const acceptedAt = "2026-11-19T10:00:00.000Z";
const running: HqBirth = {
  id: "birth",
  face: "rose:seal",
  madeBy: "ada",
  intent: plan,
  operation: { kind: "birth", phase: "accepted", acceptedAt, at: acceptedAt },
  state: "running",
  offers: ["delete"],
};

const decodeBirths = Schema.decodeUnknownSync(
  Schema.Struct({
    births: Schema.Array(
      Schema.Struct({ operation: HqBirthOperation, offers: Schema.Array(HqBirthOffer) }),
    ),
  }),
);
/** What HQ's recorded delivery offers on the birth it shows; nothing once the birth ended. */
const answeredOffers = (name: string): ReadonlyArray<HqBirthOffer> =>
  recorded("scope-values", `mate-hq/navigation.birth.${name}`)
    .values.filter((v) => v.key.startsWith("app:"))
    .flatMap((v) => decodeBirths(v.value).births)
    .flatMap((b) => b.offers);

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | offer === "continue" || → (offer === "continue" && person.editRecord) ||
it("PJ135: A birth offers Continue, Delete or its project's deletion only where HQ offers it and the person's live permission allows it; breaks: a bound birth offers its maker a Delete HQ refuses, or a person without the right is offered one", () => {
  const nobody = { addMate: false, editRecord: false };
  const everyone = { addMate: true, editRecord: true };
  const examples = [
    // HQ names the reader in its Continue: kept whatever their permission.
    { offers: ["continue"], person: nobody, offered: ["continue"] },
    {
      offers: answeredOffers("running"),
      person: { addMate: true, editRecord: false },
      offered: ["delete"],
    },
    { offers: ["delete"], person: { addMate: false, editRecord: true }, offered: [] },
    {
      offers: ["delete_project"],
      person: { addMate: false, editRecord: true },
      offered: ["delete_project"],
    },
    { offers: ["delete_project"], person: { addMate: true, editRecord: false }, offered: [] },
    // A bound birth HQ gives no offer (its create in flight, its deletion running) offers its
    // maker no Delete.
    { offers: answeredOffers("ended"), person: everyone, offered: [] },
    // A waiting bound birth: its maker continues it, and deletes its project only with the right.
    {
      offers: answeredOffers("waiting-token-expired"),
      person: { addMate: true, editRecord: false },
      offered: ["continue"],
    },
    {
      offers: answeredOffers("waiting-token-expired"),
      person: everyone,
      offered: ["continue", "delete_project"],
    },
  ] as const;
  expect(examples.map(({ offers, person }) => birthOffersFor(offers, person))).toEqual(
    examples.map(({ offered }) => offered),
  );
});

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | birth.state === "running" && → birth.state !== "failed" &&
it("PJ144: A running birth HQ offers no Delete holds Delete, drawn and not pressable, for a person HQ offers its Mate's record and for nobody else; breaks: a new Mate has no menu while it comes up, or one that failed promises a Delete that never comes", () => {
  const examples = [
    { state: "running", offers: [], editRecord: true, held: true },
    { state: "running", offers: [], editRecord: false, held: false },
    { state: "running", offers: ["delete"], editRecord: true, held: false },
    { state: "waiting_for_maker", offers: ["continue"], editRecord: true, held: false },
    { state: "failed", offers: [], editRecord: true, held: false },
    { state: "awaiting_link", offers: ["delete_project"], editRecord: true, held: false },
  ] as const;
  expect(examples.map((birth) => birthDeleteHeld(birth, birth.editRecord))).toEqual(
    examples.map(({ held }) => held),
  );
});

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | offer.edit.kind === "allowed" → offer.edit.kind !== "unknown"
it("PJ134: A bound birth HQ ended with a failure offers Delete of its project only to a person HQ offers its Mate's record; breaks: a Read only person is offered a Delete HQ refuses", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({
    running: [],
    projects: [{ id: "p1", name: "Shop - Ada" }],
    services: [],
  }).forEach(store.dispatch);
  membershipInputs("READ_ONLY", true).forEach(store.dispatch);
  seedHqNavigation(store, ORG, {
    structure: {
      apps: [
        {
          id: "app",
          name: "Shop",
          projects: [
            {
              projectId: "p1",
              name: "Shop - Ada",
              kind: "mate",
              mate: { face: "rose:seal", birthId: "birth" },
            },
          ],
          births: [
            {
              ...running,
              projectId: "p1",
              operation: {
                kind: "birth",
                phase: "import_accepted",
                acceptedAt,
                at: failedAt,
                failure: {
                  step: "import",
                  code: "build_failed",
                  at: failedAt,
                  origin: "zerops_process",
                },
              },
              state: "failed",
              offers: ["delete_project"],
            },
          ],
        },
      ],
      ungrouped: [],
    },
  });
  const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
  const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
  expect(registry.get(read).open).toMatchObject([{ state: "failed", offers: [] }]);
  membershipInputs("ADMIN", false, 2).forEach(store.dispatch);
  expect(registry.get(read).open).toMatchObject([{ state: "failed", offers: ["delete_project"] }]);
  stop();
  store.close();
  registry.dispose();
});
// witness: packages/client-runtime/src/data/projections/birthProgress.ts | reason: importFailure → reason: null
it("PJ59: An accepted import that failed blocks another import and keeps the platform's reason", () => {
  const failed = processValue({
    id: "i1",
    projectId: "p1",
    status: "FAILED",
    actionName: "stack.create",
    failReason: "No capacity.",
  });
  expect(
    birthProgressOf({
      birth: {
        projectId: "p1",
        importProcessId: "i1",
        operation: { kind: "birth", phase: "import_accepted", acceptedAt, at: acceptedAt },
      },
      service: null,
      importProcess: failed,
    }),
  ).toMatchObject({
    phase: "import-accepted",
    next: { kind: "blocked" },
    reason: "No capacity.",
  });
});

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | ...(birth.adopted === true ? { adopted: true as const } : {}), → ...(birth.adopted === true ? {} : {}),
it("PJ67: An adopted birth is marked adopted, so deleting it leaves its existing project", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [], projects: [{ id: "p1", name: "Existing" }], services: [] }).forEach(
    store.dispatch,
  );
  membershipInputs("OWNER").forEach(store.dispatch);
  const adopted = { ...running, projectId: "p1", adopted: true };
  seedHqNavigation(store, ORG, {
    structure: {
      apps: [{ id: "app", name: "Shop", projects: [], births: [adopted] }],
      ungrouped: [],
    },
  });
  const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
  const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
  expect(registry.get(read).open).toMatchObject([
    { id: "birth", adopted: true, offers: ["delete"] },
  ]);
  stop();
  store.close();
  registry.dispose();
});

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | (HQ_BIRTH_LEFT as ReadonlyArray<string>).includes(left), → left !== "",
it("PJ137: An adopted birth carries what HQ says its attempt left in the project, in HQ's order, reading past a thing this build does not know, and a birth HQ names nothing of carries nothing; breaks: the Delete dialog names a thing HQ never said, or drops the Mate key HQ now refuses", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [], projects: [{ id: "p1", name: "Existing" }], services: [] }).forEach(
    store.dispatch,
  );
  membershipInputs("OWNER").forEach(store.dispatch);
  const adopted = {
    ...running,
    projectId: "p1",
    adopted: true,
    left: ["zcp_service", "mate_key", "service_accounts", "mate_tag", "zcp_enabled"],
  };
  const made = { ...running, id: "made" };
  seedHqNavigation(store, ORG, {
    structure: {
      apps: [{ id: "app", name: "Shop", projects: [], births: [adopted, made] }],
      ungrouped: [],
    },
  });
  const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
  const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
  expect(registry.get(read).open.map(({ id, left }) => ({ id, left }))).toEqual([
    { id: "birth", left: ["zcp_service", "mate_key", "mate_tag", "zcp_enabled"] },
    { id: "made", left: undefined },
  ]);
  stop();
  store.close();
  registry.dispose();
});

// witness: packages/client-runtime/src/data/projections/birthProgress.ts | const roleLive = membership.kind === "known" && read.stream(membership.scope).phase === "live"; → const roleLive = membership.kind === "known";
it("PJ96: A birth offers Delete only while its person's role is read live and allows it", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  liveZerops({ running: [], projects: [], services: [] }).forEach(store.dispatch);
  membershipInputs("OWNER").forEach(store.dispatch);
  seedHqNavigation(store, ORG, {
    structure: {
      apps: [{ id: "app", name: "Shop", projects: [], births: [running] }],
      ungrouped: [],
    },
  });
  const read = store.data.project(sharedBirths, { orgId: ORG, personId: "ada" });
  const stop = registry.subscribe(read, () => registry.get(read), { immediate: true });
  const actions = () => registry.get(read).open.map(({ offers }) => offers);
  expect(actions()).toEqual([["delete"]]);
  membershipInputs("READ_ONLY", false, 2).forEach(store.dispatch);
  expect(actions()).toEqual([[]]);
  membershipInputs("OWNER", false, 3).forEach(store.dispatch);
  expect(actions()).toEqual([["delete"]]);
  store.dispatch({
    kind: "stream",
    key: `zerops:${ORG}:organization-user:${ORG}`,
    now: 4,
    event: { kind: "fault", fault: { outcome: "transient", message: "disconnected" }, jitter: 0 },
  });
  expect(actions()).toEqual([[]]);
  stop();
  store.close();
  registry.dispose();
});
