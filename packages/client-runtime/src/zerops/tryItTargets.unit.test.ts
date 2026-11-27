import { expect, it } from "vite-plus/test";
import { tryItTargets } from "./tryItTargets.ts";

const previewRepo = "https://hq.example/git/org/app/web.git";
const previewRoutes = [
  { service: "webstage", url: "https://stage.example", host: "stage.example", port: 443 },
];
const previewInput = {
  routes: previewRoutes,
  hostnames: ["webpool", "webstage"],
  pools: ["webpool"],
  controlPlane: undefined,
  tier: undefined,
  repository: "web",
  repositoryUrl: previewRepo,
  repositoryRemote: undefined,
};

// witness: packages/client-runtime/src/zerops/tryItTargets.ts | part.devService !== input.repository && !sameRepository(repositories.get(stage.service)) → part.devService !== input.repository && false
it("ZV203: A routed app stage is offered only for the change's repository, including after its build report leaves; breaks: a merged change loses its app address or opens another repository's app.", () => {
  const tier = `services:
  - hostname: webdev
    type: nodejs@22
    buildFromGit: https://hq.example/git/org/app/web.git
    zeropsSetup: web
  - hostname: webstage
    type: nodejs@22
    buildFromGit: https://hq.example/git/org/app/web.git
    zeropsSetup: web`;
  const input = {
    ...previewInput,
    tier,
    poolPairs: [{ pool: "webpool", stages: [{ hostname: "webstage" }] }],
  };
  expect(tryItTargets(input).builds.map((target) => target.url)).toEqual(["https://stage.example"]);
  expect(
    tryItTargets({
      ...input,
      repositoryUrl: "https://hq.example/git/org/app/other.git",
      repository: "other",
    }).builds,
  ).toEqual([]);
});
