import { describe, expect, it } from "vite-plus/test";
import { hqAppFamily, placementFamily, hqPersonFamily } from "./hqNavigation.ts";

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
  mate: { face: "ada", madeBy: null, standupRequestedBy: null, closedOff: false, keyWider: false },
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
