import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { EnvironmentId, type CrewSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { readCrewThread } from "../../../zerops/crew/useCrew";
import { CrewSection, CrewSectionEmpty, type CrewSectionProps } from "./CrewSection";

const noop = () => {};
const sent = async () => null;

const render = (snapshot: CrewSnapshot, overrides: Partial<CrewSectionProps> = {}) =>
  renderToStaticMarkup(
    <CrewSection
      environmentId={EnvironmentId.make("env-crew")}
      error={null}
      onAddCrewPorts={noop}
      onAddLead={noop}
      onStartRun={noop}
      onAsk={noop}
      onDeliver={noop}
      onEditBrief={noop}
      onEditCrewmate={noop}
      onOpenBoard={null}
      onOpenThread={noop}
      onRemove={noop}
      onStartFresh={noop}
      pending={false}
      send={sent}
      snapshot={snapshot}
      tell={{ send: sent, pending: false, error: null }}
      treeCwd="/var/www"
      view={deriveCrewView(snapshot, [], readCrewThread)}
      {...overrides}
    />,
  );

describe("CrewSectionEmpty", () => {
  it("offers to set up a crew", () => {
    const markup = renderToStaticMarkup(<CrewSectionEmpty onSetUp={noop} />);
    expect(markup).toContain(
      "Named crewmates, each with its own job and its own copy of the code.",
    );
    expect(markup).toContain("Set up a crew");
  });
});

describe("CrewSection", () => {
  it("reads the applied crew top to bottom", () => {
    const markup = render(crewSnapshotFixture());
    const order = [
      "Camera and HUD rework",
      "Running · 1 h 12 m",
      "Spend $6.40 of $20 · Time 1 h 12 m of 8 h · Usage 54 %, stops at 80",
      "v4",
      "Erik asks: Pricing in CZK or EUR?",
      "@lead",
      "@backend",
      "v5 at next turn",
      "@frontend",
      "@erik",
      "Tell the crew… use @ to address",
      "appdev serves: your tree",
      "Landed, not delivered · 1",
    ].map((text) => markup.indexOf(text));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  it("offers each Waiting on you row its presses", () => {
    const markup = render(crewSnapshotFixture(), { onOpenBoard: noop });
    for (const label of ["Answer", "Commit my edit", "Review plan", "Allow", "Not now"]) {
      expect(markup).toContain(`>${label}<`);
    }
    expect(render(crewSnapshotFixture())).not.toContain(">Review plan<");
  });

  it("shows a run's controls and meters only while a run is on, and a lead's send only with a lead", () => {
    const snapshot = crewSnapshotFixture();
    const manual = render({
      ...snapshot,
      run: null,
      crewmates: snapshot.crewmates.slice(1),
      attention: [],
    });

    expect(manual).not.toContain("Pause");
    expect(manual).not.toContain("Spend ");
    expect(manual).not.toContain("Send to lead");
    expect(render(snapshot)).toContain("Send to lead");
    expect(render(snapshot)).toContain("Pause");
    expect(render(snapshot)).not.toContain("Start run");
    expect(render({ ...snapshot, run: null })).toContain("Start run");
  });

  it("reads a paused run, offers Resume and Stop, and meters a budget without a limit", () => {
    const snapshot = crewSnapshotFixture();
    const paused = render({
      ...snapshot,
      run: {
        ...snapshot.run!,
        state: "paused",
        reason: "budget",
        options: { ...snapshot.run!.options, budgetUsd: "unlimited" },
      },
    });

    expect(paused).toContain("Paused · budget reached");
    expect(paused).toContain(">Resume<");
    expect(paused).toContain(">Stop<");
    expect(paused).not.toContain(">Pause<");
    expect(paused).toContain("Spend $6.40 · no limit · Time 1 h 12 m of 8 h");
  });

  it("meters a run without usage until the first rate-limit event, and words a refused pause", () => {
    const snapshot = crewSnapshotFixture();
    const running = render({ ...snapshot, run: { ...snapshot.run!, usagePercent: null } });
    expect(running).toContain("Spend $6.40 of $20 · Time 1 h 12 m of 8 h<");
    expect(running).not.toContain("Usage");

    const refused = render({
      ...snapshot,
      run: {
        ...snapshot.run!,
        state: "paused",
        reason: "refused",
        reasonDetail: "Backend's login is not yours",
      },
    });
    expect(refused).toContain("Paused · Backend&#x27;s login is not yours");
  });

  it("offers + Add lead exactly while the crew has no lead", () => {
    const snapshot = crewSnapshotFixture();
    const leadless = { ...snapshot, crewmates: snapshot.crewmates.slice(1) };

    expect(render(snapshot)).not.toContain("+ Add lead");
    expect(render(leadless)).toContain("+ Add lead");
    expect(render({ ...leadless, run: null })).toContain("+ Add lead");
  });

  it("opens the board only where there is one to open", () => {
    expect(render(crewSnapshotFixture())).not.toContain("Board ·");
    expect(render(crewSnapshotFixture(), { onOpenBoard: noop })).toContain("Board · 8 tasks");
  });

  it("names a crewmate's copy served on dev, with the way back", () => {
    const snapshot = crewSnapshotFixture();
    const markup = render({
      ...snapshot,
      hosts: [{ ...snapshot.hosts[0]!, served: { by: "crewmate", handle: "frontend" } }],
    });
    expect(markup).toContain("appdev serves: Frontend&#x27;s copy");
    expect(markup).toContain("Back to my tree");
  });

  it("offers crew ports on a service that has none", () => {
    const snapshot = crewSnapshotFixture();
    const markup = render({ ...snapshot, hosts: [{ ...snapshot.hosts[0]!, crewPorts: [] }] });
    expect(markup).toContain("appdev · Crew ports: off");
    expect(markup).toContain("Add crew ports");
  });
});
