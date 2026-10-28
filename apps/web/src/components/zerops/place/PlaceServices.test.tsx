import { serviceRows } from "@t3tools/client-runtime/zerops/flow";
import type { HqJob } from "@t3tools/client-runtime/zerops/hq";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";

vi.mock("~/zerops/usePublicAccess", () => ({
  usePublicAccess: () => ({ bound: false, state: "ready", pending: [] }),
}));
vi.mock("../ZeropsDeployLog", () => ({
  useDeployLogUnavailable: () => false,
  DeployLogDetails: () => null,
}));

import { PlaceServiceTable } from "./PlaceServices";

it.each([
  [undefined, "Source archive size is not available yet."],
  [null, "Source archive size is not available yet."],
  [0, "Source archive: 0 B"],
  [1_305_166_613, "Source archive: 1.31 GB"],
] as const)(
  "a service renders its latest deployment's measured archive after it is live: %j",
  (sourceArchiveBytes, expected) => {
    const latest: HqJob = {
      id: "7",
      kind: "deploy",
      service: "api",
      sha: "a".repeat(40),
      state: "live",
      cause: "merge",
      ref: null,
      reason: null,
      appVersionId: null,
      processId: null,
      requestedBy: null,
      at: "2026-10-28T00:00:00Z",
      endedAt: "2026-10-28T00:01:00Z",
      supersededBy: null,
      ...(sourceArchiveBytes === undefined ? {} : { sourceArchiveBytes }),
    };
    const [code] = serviceRows({
      environment: "stage",
      services: [{ hostname: "api", repository: "api", deploy: { latest, live: latest } }],
      platform: { state: "unread", waitingFor: null },
      mainHead: undefined,
      routes: [],
      offers: [],
      nowMs: 0,
      age: () => "now",
    });
    const markup = renderToStaticMarkup(
      <PlaceServiceTable
        projectId="stage"
        rows={[
          {
            hostname: "api",
            code,
            platform: undefined,
            type: undefined,
            under: undefined,
            compute: false,
          },
        ]}
        usageRead={false}
        answered={new Map()}
        said={undefined}
        onEnableRoute={undefined}
        enablingServiceId={null}
        deployAgain={undefined}
      />,
    );
    expect(markup).toContain(expected);
    expect(markup).not.toContain("Git storage");
  },
);
