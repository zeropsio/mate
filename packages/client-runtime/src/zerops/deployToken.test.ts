import { describe, expect, it } from "vite-plus/test";

import {
  deployTokenName,
  deployTokenVariable,
  environmentsWithoutDeployToken,
  planDeployToken,
} from "./deployToken.ts";

describe("an environment's deploy token", () => {
  it("names its variable the way the broker does", () => {
    // The same vector as gitea-mate's `TestTokenVariable`: the two spell one
    // name or the broker finds no key.
    expect(deployTokenVariable("hadSu0iZ-uCG_Ic1hicN4Q")).toBe(
      "MATE_DEPLOY_TOKEN_686164537530695A2D7543475F4963316869634E3451",
    );
  });

  it("is called after the environment in the account's token list", () => {
    expect(deployTokenName(" Todo - stage ")).toBe("deploy-Todo - stage");
  });

  it("is one project's key and nothing else's", () => {
    expect(
      planDeployToken({
        projectId: "p-stage",
        environmentName: "Todo - stage",
        brokerVariables: [],
      }),
    ).toEqual({
      kind: "mint",
      name: "deploy-Todo - stage",
      roleCode: "NO_ACCESS",
      projects: [{ projectId: "p-stage", roleCode: "BASIC_USER" }],
      variable: deployTokenVariable("p-stage"),
    });
  });

  it("is minted once: a key the broker holds is left alone", () => {
    expect(
      planDeployToken({
        projectId: "p-stage",
        environmentName: "Todo - stage",
        brokerVariables: ["MATE_ZEROPS_TOKEN", deployTokenVariable("p-stage")],
      }),
    ).toEqual({ kind: "held" });
  });

  it("lists the declared environments the broker holds no key for", () => {
    expect(
      environmentsWithoutDeployToken({
        declaredProjects: ["p-stage", "p-prod"],
        brokerVariables: [deployTokenVariable("p-prod"), "GITEA_URL"],
      }),
    ).toEqual(["p-stage"]);
  });
});
