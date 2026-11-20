import { expect, it } from "vite-plus/test";

import { assignCrewPorts, proposeCrewPorts, readDeclaredPorts } from "./crewPorts.ts";

const yaml = (setups: string) => `zerops:\n${setups}`;

const setup = (name: string, ports: string) =>
  `  - setup: ${name}\n    run:\n      ports:\n${ports}`;

const port = (value: number, http = true) =>
  `        - port: ${value}\n          httpSupport: ${http}\n`;

// witness: apps/server/src/zerops/crew/crewPorts.ts | setups.find((setup) => setup.setup === "dev") → setups.find((setup) => setup.setup === "prod")
it("CM29: A service's crew ports are the HTTP ports from 3001 up of its setup named after the service, else its dev setup, else its only setup, never that setup's first port; a zerops.yaml that does not parse or has no such setup gives none", () => {
  const declared = (text: string) => readDeclaredPorts(text, "appdev");
  expect(
    declared(
      yaml(
        setup("appstage", port(3000)) +
          setup("appdev", port(3000) + port(3001) + port(3002) + port(3003, false) + port(2999)),
      ),
    ),
  ).toEqual({ main: 3000, crew: [3001, 3002] });
  expect(declared(yaml(setup("prod", port(8080)) + setup("dev", port(8080) + port(3004))))).toEqual(
    { main: 8080, crew: [3004] },
  );
  expect(declared(yaml(setup("app", port(3000))))).toEqual({ main: 3000, crew: [] });
  expect(declared(yaml(setup("web", port(3000)) + setup("api", port(3000))))).toBeUndefined();
  expect(declared("zerops: [")).toBeUndefined();
});

// witness: apps/server/src/zerops/crew/crewPorts.ts | member.crewPort !== null && ports.includes(member.crewPort) → member.crewPort !== null
it("CM30: Each crewmate on a service keeps a crew port it has that is still declared, the others take the free ones lowest first, and one left over gets none", () => {
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

// witness: apps/server/src/zerops/crew/crewPorts.ts | let port = CREW_PORT_FLOOR; → let port = CREW_PORT_FLOOR + 1;
it("CM31: Add crew ports proposes the next ports from 3001 that the service declares for nothing", () => {
  expect(proposeCrewPorts({ main: 3000, crew: [3001, 3003] }, 3)).toEqual([3002, 3004, 3005]);
  expect(proposeCrewPorts(undefined, 2)).toEqual([3001, 3002]);
});
