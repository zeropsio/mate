import { expect, it } from "vite-plus/test";
import {
  environmentSheetSubmit,
  type RecipeOption,
} from "./ZeropsEnvironmentCreationDialog.logic.ts";

const empty: RecipeOption = {
  id: "none",
  label: "Empty",
  detail: "Nothing yet",
  choice: { kind: "none" },
};
const seeing = [
  { clientUserId: "member-ada", roleCode: "DEVELOPER" },
  { clientUserId: "member-bo", roleCode: "GUEST" },
];

// witness: apps/web/src/components/zerops/ZeropsEnvironmentCreationDialog.logic.ts | ...(userRoles.length === 0 ? {} : { userRoles }), → ...(userRoles.length === 0 ? { userRoles } : {}),
it("MN9: A new stage keeps the people who could see its project", () => {
  const sent = environmentSheetSubmit({
    role: "stage",
    name: "bakery-stage",
    withAgent: true,
    options: [empty],
    recipe: "present",
    people: { kind: "ready", userRoles: seeing },
  });
  expect(sent.kind).toBe("create");
  expect(sent.kind === "create" ? sent.choice.userRoles : undefined).toEqual(seeing);

  expect(
    environmentSheetSubmit({
      role: "stage",
      name: "bakery-stage",
      withAgent: true,
      options: [empty],
      recipe: "present",
      people: { kind: "reading" },
    }).kind,
  ).toBe("held");
});
