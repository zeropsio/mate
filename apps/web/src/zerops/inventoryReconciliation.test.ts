import { describe, expect, it } from "vite-plus/test";
import { reconcileInventoryProjects } from "./inventoryReconciliation";
const previous = [
  { id: "removed", clientId: "available", name: "Removed elsewhere", status: "ACTIVE" },
  { id: "uncertain", clientId: "offline", name: "Retain while offline", status: "ACTIVE" },
];
describe("inventory scope reconciliation", () => {
  it("applies confirmed deletion while retaining an unrelated failed scope", () => {
    expect(reconcileInventoryProjects(previous, [], new Set(["offline"]))).toEqual([previous[1]]);
  });
  it("removes retained stale data only once that scope returns a complete empty list", () => {
    expect(reconcileInventoryProjects(previous, [], new Set())).toEqual([]);
  });
  it("keeps the fresh object if a result already contains the same project", () => {
    const fresh = { ...previous[1]!, name: "Renamed" };
    expect(reconcileInventoryProjects(previous, [fresh], new Set(["offline"]))).toEqual([fresh]);
  });
});
