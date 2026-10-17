import { expect, it } from "vite-plus/test";
import { automatedMatesWire } from "./automatedMates.ts";

const frame = (values: ReadonlyArray<{ key: string; value: unknown }>) =>
  JSON.stringify({
    type: "scope-values",
    scope: { kind: "navigation" },
    incarnation: "i",
    revision: 2,
    values,
    removals: [],
  });

it("makes the named Mates automated on the task set now, their application's tasks waiting", () => {
  const wire = automatedMatesWire(["Nova"]);
  wire.set({ task: { number: 12, title: "Fix the checkout total" }, waiting: 2 });
  const values = JSON.parse(
    wire.map(
      frame([
        { key: "app:tea", value: { name: "Tea Shop", projectIds: ["Nova", "Ida"] } },
        { key: "project:Nova", value: { appId: "tea", mate: { face: "" } } },
        { key: "project:Ida", value: { appId: "tea", mate: { face: "" } } },
      ]),
    ),
  ).values;
  expect(values[0].value.intake).toEqual({ repo: "acme/tea-shop", label: "mate", waiting: 2 });
  expect(values[1].value.mate).toMatchObject({
    automated: true,
    task: { number: 12, title: "Fix the checkout total", repo: "acme/tea-shop" },
  });
  expect(values[2].value.mate).toEqual({ face: "" });
  wire.set({ task: null, waiting: 0 });
  expect(
    JSON.parse(wire.map(frame([{ key: "project:Nova", value: { mate: { face: "" } } }]))).values[0]
      .value.mate,
  ).toEqual({ face: "", automated: true, task: null });
  expect(wire.map("binary-or-other-frame")).toBe("binary-or-other-frame");
});
