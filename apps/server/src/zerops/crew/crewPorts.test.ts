import { describe, expect, it } from "@effect/vitest";

import { assignCrewPorts, proposeCrewPorts, readDeclaredPorts } from "./crewPorts.ts";

const yaml = (setups: string) => `zerops:\n${setups}`;

const setup = (name: string, ports: string) =>
  `  - setup: ${name}\n    run:\n      ports:\n${ports}`;

const port = (value: number, http = true) =>
  `        - port: ${value}\n          httpSupport: ${http}\n`;

describe("crew ports", () => {
  it.each([
    [
      "the setup named after the service; the first port is its own",
      yaml(
        setup("appstage", port(3000)) +
          setup("appdev", port(3000) + port(3001) + port(3002) + port(3003, false) + port(2999)),
      ),
      { main: 3000, crew: [3001, 3002] },
    ],
    [
      "the dev setup when none is named after the service",
      yaml(setup("prod", port(8080)) + setup("dev", port(8080) + port(3004))),
      { main: 8080, crew: [3004] },
    ],
    ["the only setup", yaml(setup("app", port(3000))), { main: 3000, crew: [] }],
    [
      "no setup for the service",
      yaml(setup("web", port(3000)) + setup("api", port(3000))),
      undefined,
    ],
    ["not YAML at all", "zerops: [", undefined],
  ])("reads %s", (_, text, expected) => {
    expect(readDeclaredPorts(text, "appdev")).toEqual(expected);
  });

  it("gives each crewmate on a service a free crew port, keeping the ones it has", () => {
    expect(
      assignCrewPorts(
        [3001, 3002, 3003],
        [
          { handle: "backend", crewPort: 3002 },
          { handle: "frontend", crewPort: null },
          { handle: "erik", crewPort: 3099 },
          { handle: "fourth", crewPort: null },
        ],
      ),
    ).toEqual(
      new Map([
        ["backend", 3002],
        ["frontend", 3001],
        ["erik", 3003],
        ["fourth", null],
      ]),
    );
  });

  it("proposes the next ports from 3001 that the service does not declare", () => {
    expect(proposeCrewPorts({ main: 3000, crew: [3001, 3003] }, 3)).toEqual([3002, 3004, 3005]);
    expect(proposeCrewPorts(undefined, 2)).toEqual([3001, 3002]);
  });
});
