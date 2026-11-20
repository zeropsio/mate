import { expect, it } from "vite-plus/test";
import {
  deriveZeropsRestartAction,
  deriveZeropsRowAction,
  type ZeropsRowCandidate,
  type ZeropsRowInput,
} from "./ZeropsProjectRow.logic.ts";

const every: ZeropsRowInput["can"] = {
  open: true,
  enable: true,
  setUpMate: true,
  start: true,
  restart: true,
  remove: true,
};

const running: ZeropsRowCandidate = {
  key: "Z_RYE:mate",
  project: { id: "Z_RYE", name: "bakery-rye", status: "ACTIVE", tagList: [] },
  group: "connected",
  service: { id: "S_MATE", name: "mate", status: "ACTIVE" },
  containerOrigin: "https://mate-1-8080.prg1.zerops.app",
};
const failedBirth: ZeropsRowCandidate = {
  ...running,
  group: "unavailable",
  creationFailed: { message: undefined },
};

const row = (
  candidate: ZeropsRowCandidate,
  can: ZeropsRowInput["can"],
  visibility: ZeropsRowInput["visibility"],
): ZeropsRowInput => ({ candidate, health: "ready", can, visibility });

// witness: apps/web/src/components/zerops/ZeropsProjectRow.logic.ts | return can.restart && → return can.open &&
it("MN+8: A Mate the person may see but not open offers no verb, not even a restart, and no row offers a verb its caller cannot perform", () => {
  expect(deriveZeropsRowAction(row(running, every, "open")).kind).toBe("open");
  expect(deriveZeropsRestartAction(row(running, every, "open")).kind).toBe("restart");

  expect(deriveZeropsRowAction(row(running, every, "listed")).kind).toBe("none");
  expect(deriveZeropsRestartAction(row(running, every, "listed")).kind).toBe("none");

  expect(deriveZeropsRowAction(row(running, { ...every, open: false }, "open")).kind).toBe("none");
  expect(deriveZeropsRestartAction(row(running, { ...every, restart: false }, "open")).kind).toBe(
    "none",
  );
  expect(deriveZeropsRowAction(row(failedBirth, { ...every, remove: false }, "open")).kind).toBe(
    "none",
  );
});
