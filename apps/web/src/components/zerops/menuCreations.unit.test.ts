import { expect, it } from "vite-plus/test";
import { menuCreations } from "../../zerops/menuCreations.ts";
import type { NewProjectBirth } from "../../zerops/newProjectBirth.ts";

const pressed: NewProjectBirth = {
  organizationId: "org-1",
  creator: "user-1",
  birthId: "birth-1",
  name: "shop",
  botName: "Ada",
  face: { tint: "slate", shape: "squircle" },
  locationId: null,
  agents: [],
  startedAt: Date.parse("2026-11-19T22:25:00Z"),
  hq: { projectId: "hq-1", address: "https://hq.example" },
  appId: null,
  intent: null,
  step: "registry",
  failed: null,
  projectId: null,
};

// witness: apps/web/src/zerops/menuCreations.ts | birth.chief === true || birth.appId !== null → true
it("MN14: An ordinary Create is drawn in the menu only once HQ has named its application, so its group carries the application's id from its first frame and is never re-keyed; a Chief's creation is drawn from the press. Breaks: the new project's group remounts 246 ms after Create and loses its open state and focus (c_4224269e check on mate-test-env-1, 2026-11-19).", () => {
  const chief: NewProjectBirth = { ...pressed, birthId: "birth-chief", chief: true, appId: null };
  const named: NewProjectBirth = { ...pressed, appId: "app-1", step: "create" };

  const frameOne = menuCreations([pressed, chief]);
  expect(frameOne.map((birth) => birth.birthId)).toEqual(["birth-chief"]);

  const frameTwo = menuCreations([named, chief]);
  expect(frameTwo.map((birth) => [birth.birthId, birth.appId])).toEqual([
    ["birth-1", "app-1"],
    ["birth-chief", null],
  ]);
});
