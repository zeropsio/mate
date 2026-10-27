import { describe, expect, it } from "vite-plus/test";
import {
  hqAppFamily,
  hqOrganizationFamily,
  placementFamily,
  hqPersonFamily,
} from "./hqNavigation.ts";
import { gitEnvironment } from "../__fixtures__/hqWire.ts";

const app = {
  id: "shop",
  name: "Shop",
  can: {},
  contents: { empty: false, deletingProjectIds: [] },
  environments: [],
  changes: [],
  releaseOffer: null,
  projectIds: ["ada"],
  births: [],
};
const project = {
  projectId: "ada",
  appId: "shop",
  name: "Ada",
  kind: "mate",
  mate: { face: "ada", madeBy: null, standupRequestedBy: null, closedOff: false },
  person: {
    role: "DEVELOPER",
    mayWrite: true,
    mine: true,
    ownerUserId: null,
    waitsOnViewer: false,
    unseen: null,
  },
  signedInNow: {},
  everSignedIn: {},
};

it("admits Git identity and exact confirmed release beside a Zerops target", () => {
  const zerops = {
    ...gitEnvironment,
    id: "stage",
    target: { kind: "zerops", projectId: "stage-project" },
    tier: "stage",
    jobs: [],
  };
  const value = hqAppFamily.hq!.decode({ environments: [zerops, gitEnvironment] }, "app:shop");
  expect(value?.environments).toEqual([zerops, gitEnvironment]);
});

it.each(["building", "live", "failed", "skipped"])(
  "Git navigation never admits the Zerops job state %s",
  (state) => {
    expect(
      hqAppFamily.hq!.decode(
        { environments: [{ ...gitEnvironment, jobs: [{ ...gitEnvironment.jobs[0], state }] }] },
        "app:shop",
      )?.environments,
    ).toBeUndefined();
  },
);
it("slice one admits direct branches only and never invents a PR target", () => {
  expect(
    hqAppFamily.hq!.decode(
      {
        environments: [{ ...gitEnvironment, target: { ...gitEnvironment.target, delivery: "pr" } }],
      },
      "app:shop",
    )?.environments,
  ).toBeUndefined();
});

describe("navigation record decoding", () => {
  it.each([undefined, "unreadable", { head: 42 }])(
    "keeps an app with an unknown release offer: %s",
    (releaseOffer) => {
      const value = hqAppFamily.hq!.decode({ ...app, releaseOffer }, "app:shop");
      expect(value).toEqual({ ...app, releaseOffer: undefined });
    },
  );
  it.each(Object.keys(app))("isolates an unreadable app fact: %s", (field) => {
    const value = hqAppFamily.hq!.decode({ ...app, [field]: 42 }, "app:shop");
    expect(value).toEqual({ ...app, [field]: undefined });
  });
  it.each(Object.keys(project))("isolates an unreadable project fact: %s", (field) => {
    expect(placementFamily.hq!.decode({ ...project, [field]: 42 }, "project:ada")).toEqual({
      ...project,
      [field]: undefined,
    });
  });
  it.each(Object.keys(project.mate))("keeps the other Mate facts when %s is missing", (field) => {
    const mate = { ...project.mate, [field]: undefined };
    expect(placementFamily.hq!.decode({ ...project, mate }, "project:ada")).toEqual({
      ...project,
      mate,
    });
  });
  it.each(Object.keys(project.person))(
    "keeps the other person facts when %s is unreadable",
    (field) => {
      expect(
        placementFamily.hq!.decode(
          { ...project, person: { ...project.person, [field]: {} } },
          "project:ada",
        ),
      ).toEqual({ ...project, person: { ...project.person, [field]: undefined } });
    },
  );
  it("keeps a person's identity when their avatar is unreadable", () => {
    expect(
      hqPersonFamily.hq!.decode(
        { name: "Ada", clientUserId: "member", avatarUrl: 42 },
        "person:ada",
      ),
    ).toEqual({ name: "Ada", clientUserId: "member", avatarUrl: undefined });
  });
  it("keeps unreadable births unknown rather than claiming none", () => {
    expect(hqAppFamily.hq!.decode({ ...app, births: [{ id: 42 }] }, "app:shop")).toEqual({
      ...app,
      births: undefined,
    });
  });
  it.each([null, [], 42, "bad"])(
    "rejects a non-record without replacing prior evidence: %s",
    (raw) => {
      expect(hqAppFamily.hq!.decode(raw, "app:shop")).toBeNull();
    },
  );
});

it("keeps modern identity and its authoritative target, even beside an older address", () => {
  const environment = {
    id: "environment-stage",
    target: { kind: "zerops", projectId: "project-stage" },
    projectId: "wrong-legacy",
    tier: "stage",
    name: "Stage",
    sources: ["main"],
    order: 1,
    keyHeld: true,
    keyInvalid: false,
    can: {},
    jobs: [],
    release: null,
    birth: null,
  };
  const app = hqAppFamily.hq!.decode({ environments: [environment] }, "app:shop");
  expect(app?.environments).toEqual([environment]);
});

it.each([[], { refused: "Changes are private" }])(
  "explicit empty or refused environments replace the known rows: %s",
  (environments) => {
    const held = hqAppFamily.hq!.decode(
      {
        ...app,
        environments: [
          {
            id: "prod",
            target: { kind: "zerops", projectId: "prod" },
            tier: "production",
            name: "production",
            sources: ["release"],
            order: 1,
            keyHeld: true,
            keyInvalid: false,
            can: {},
            jobs: [],
          },
        ],
      },
      "app:shop",
    )!;
    const row = hqAppFamily.hq!.decode({ ...app, environments }, "app:shop")!;
    expect(hqAppFamily.keepUnsaid?.(held, row, false) ?? row).toEqual(row);
  },
);

describe("the organization's record, as its reader reads it", () => {
  const organization = { can: {}, unheld: {}, tools: [], build: "0.15.80" };
  const decode = (raw: unknown) =>
    hqOrganizationFamily.hq!.decode(raw, "org", { orgId: "org", ownerId: null });
  it.each([
    {
      sentence: "It keeps when its reader first signed in to HQ, and whether they set HQ up",
      viewer: { firstSignedInAt: "2026-10-16T08:00:00Z", founder: false },
      read: { firstSignedInAt: "2026-10-16T08:00:00Z", founder: false },
    },
    {
      sentence: "An older HQ's record says nothing of its reader's first sign-in",
      viewer: undefined,
      read: undefined,
    },
    {
      sentence: "A first sign-in sent unreadably is unknown, and the record stands",
      viewer: { firstSignedInAt: 42, founder: "yes" },
      read: undefined,
    },
  ])("$sentence", ({ viewer, read }) => {
    expect(decode(viewer === undefined ? organization : { ...organization, viewer })).toEqual(
      read === undefined ? organization : { ...organization, viewer: read },
    );
  });
});
