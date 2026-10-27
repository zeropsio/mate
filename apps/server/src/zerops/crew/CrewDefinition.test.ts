import { describe, expect, it } from "@effect/vitest";

import { crewLane } from "./CrewDefinition.ts";

describe("crewLane", () => {
  it("puts a lane in its service's tree", () => {
    expect(
      crewLane({ host: "appdev", mountPath: "/var/www/appdev", remotePath: "/var/www" }, "backend"),
    ).toEqual({
      host: "appdev",
      handle: "backend",
      branch: "crew/backend",
      mountRoot: "/var/www/appdev",
      mountDir: "/var/www/appdev/.crew/backend",
      remoteRoot: "/var/www",
      remoteDir: "/var/www/.crew/backend",
    });
  });
});
