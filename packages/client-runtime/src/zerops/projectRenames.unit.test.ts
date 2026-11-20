import { expect, it } from "vite-plus/test";

import {
  planProjectLeave,
  planProjectMove,
  planProjectRenames,
  renameStillDue,
  renamesLeft,
  runProjectRenames,
} from "./projectRenames.ts";

// witness: packages/client-runtime/src/zerops/projectRenames.ts | const own = nameUnderApp(whole, oldApp); → const own = whole;
it("ZV43: Renaming an application renames each of its projects from the old name's prefix to the new one; a project without that prefix keeps its whole name as its own under the new one", () => {
  expect(planProjectRenames([{ id: "p1", name: "SPN - Rune" }], "SPN", "Shop")).toEqual([
    { projectId: "p1", from: "SPN - Rune", to: "Shop - Rune" },
  ]);
  expect(planProjectRenames([{ id: "p4", name: "Sage" }], "SPN", "Shop")).toEqual([
    { projectId: "p4", from: "Sage", to: "Shop - Sage" },
  ]);
  expect(planProjectRenames([{ id: "p5", name: "Old - Rune" }], "SPN", "Shop")).toEqual([
    { projectId: "p5", from: "Old - Rune", to: "Shop - Old - Rune" },
  ]);
});

// witness: packages/client-runtime/src/zerops/projectRenames.ts | if (own === whole && nameUnderApp(whole, newApp) !== whole) return []; → if (own !== whole && nameUnderApp(whole, newApp) !== whole) return [];
it("ZV44: A project already named for the new application, and not for the old one, is not renamed", () => {
  expect(planProjectRenames([{ id: "p6", name: "Shop - Ada" }], "SPN", "Shop")).toEqual([]);
});

// witness: packages/client-runtime/src/zerops/projectRenames.ts | if (old === undefined || old === "" || old === newApp.trim()) return []; → if (old === "" || old === newApp.trim()) return [];
it("ZV45: Nothing is renamed where the old application's name has not been read", () => {
  expect(planProjectRenames([{ id: "p1", name: "SPN - Rune" }], undefined, "Shop")).toEqual([]);
});

// witness: packages/client-runtime/src/zerops/projectRenames.ts | return planOne(project, oldApp?.trim(), newApp); → return planOne(project, undefined, newApp);
it("ZV46: A Mate moved into another application is renamed under the new one from its old application's prefix, or from its whole name where it has none", () => {
  expect(planProjectMove({ id: "p1", name: "SPN - Rune" }, "SPN", "Shop")).toEqual([
    { projectId: "p1", from: "SPN - Rune", to: "Shop - Rune" },
  ]);
  expect(planProjectMove({ id: "p1", name: "Rune" }, undefined, "Shop")).toEqual([
    { projectId: "p1", from: "Rune", to: "Shop - Rune" },
  ]);
  expect(planProjectMove({ id: "p1", name: "Shop - Rune" }, undefined, "Shop")).toEqual([]);
});

// witness: packages/client-runtime/src/zerops/projectRenames.ts | const to = nameUnderApp(project.name, oldApp); → const to = project.name;
it("ZV47: A Mate leaving every application keeps only its own name; one without its application's prefix stands as it is", () => {
  expect(planProjectLeave({ id: "p1", name: "SPN - Rune" }, "SPN")).toEqual([
    { projectId: "p1", from: "SPN - Rune", to: "Rune" },
  ]);
  expect(planProjectLeave({ id: "p1", name: "Rune" }, "SPN")).toEqual([]);
  expect(planProjectLeave({ id: "p1", name: "Old - Rune" }, "SPN")).toEqual([]);
});

const plan = [
  { projectId: "p1", from: "SPN - Rune", to: "Shop - Rune" },
  { projectId: "p2", from: "SPN - stage", to: "Shop - stage" },
  { projectId: "p3", from: "Sage", to: "Shop - Sage" },
] as const;

// witness: packages/client-runtime/src/zerops/projectRenames.ts | return { rename, reason: zeropsErrorMessage(cause) }; → return undefined;
it("ZV48: A refused rename is kept with Zerops' reason beside the renames that went through", async () => {
  const failures = await runProjectRenames(plan, async (rename) => {
    if (rename.projectId === "p2") throw new Error("No access.");
  });
  expect(failures).toEqual([{ rename: plan[1], reason: "No access." }]);
  expect(await runProjectRenames(plan, async () => undefined)).toEqual([]);
});

// witness: packages/client-runtime/src/zerops/projectRenames.ts | return failures.map(({ rename }) => rename); → return failures.map(({ rename }) => ({ ...rename, to: rename.from }));
it("ZV49: A retry sends the failed renames with the targets they were planned with, never targets planned again", () => {
  expect(renamesLeft([{ rename: plan[1], reason: "x" }])).toEqual([plan[1]]);
});

// witness: packages/client-runtime/src/zerops/projectRenames.ts | return left !== undefined && left.from.trim() === currentName.trim() ? left : undefined; → return left !== undefined ? left : undefined;
it("ZV50: A rename left over is offered to finish only while its project still bears the name it was planned from", () => {
  const left = { projectId: "p1", from: "SPN - Rune", to: "Shop - Rune" };
  expect(renameStillDue(left, " SPN - Rune ")).toEqual(left);
  expect(renameStillDue(left, "Shop - Rune")).toBeUndefined();
  expect(renameStillDue(left, "Milo")).toBeUndefined();
  expect(renameStillDue(undefined, "SPN - Rune")).toBeUndefined();
});
