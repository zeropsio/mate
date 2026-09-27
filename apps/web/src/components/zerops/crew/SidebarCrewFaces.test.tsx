import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { EnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { SidebarCrewFaces } from "./SidebarCrewFaces";

const read = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../../zerops/crew/useCrew", () => ({ useCrew: () => read.current }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => undefined }));

const ENVIRONMENT = EnvironmentId.make("env-crew");
const snapshot = crewSnapshotFixture();
const view = deriveCrewView(snapshot, [], () => {
  throw new Error("no shells here");
});

describe("SidebarCrewFaces", () => {
  it("stacks three faces, the lead first, then the rest as a count", () => {
    read.current = { status: "applied", snapshot, view, current: true };
    const markup = renderToStaticMarkup(<SidebarCrewFaces environmentId={ENVIRONMENT} />);

    expect(markup.match(/aria-label="Open [^"]+"/gu)).toEqual([
      'aria-label="Open Lead"',
      'aria-label="Open Backend"',
      'aria-label="Open Frontend"',
    ]);
    expect(markup).toContain("+1");
  });

  it("draws nothing without an applied crew", () => {
    read.current = { status: "none", snapshot: null, view: null, current: true };
    expect(renderToStaticMarkup(<SidebarCrewFaces environmentId={ENVIRONMENT} />)).toBe("");
  });
});
