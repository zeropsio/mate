import { expect, it } from "vite-plus/test";

import { recipeProjectImportYaml } from "./recipeTier.ts";

const services = ["services:", "  - hostname: app", "    type: php-nginx@8.4"];

// witness: packages/client-runtime/src/zerops/recipeTier.ts | const start = lines.findIndex((line) => line.trim().length > 0 && !line.startsWith("#")); → const start = lines.findIndex((line) => line.trim().length > 0);
it("ZV144: The recipe project import never carries isolation and keeps the preprocessor header first", () => {
  const withProject = [
    "#yamlPreprocessor=on",
    "project:",
    "  name: laravel-recipe",
    "  envIsolation: none",
    "  envVariables:",
    "    APP_KEY: <@generateRandomString(<32>)>",
    "    envIsolation: none",
    ...services,
  ].join("\n");
  expect(recipeProjectImportYaml(withProject, { name: "Shop - stage" }).split("\n")).toEqual([
    "#yamlPreprocessor=on",
    "project:",
    "  name: Shop - stage",
    "  envVariables:",
    "    APP_KEY: <@generateRandomString(<32>)>",
    ...services,
  ]);

  const servicesOnly = ["#yamlPreprocessor=on", ...services].join("\n");
  expect(recipeProjectImportYaml(servicesOnly, { name: "Shop - stage" }).split("\n")).toEqual([
    "#yamlPreprocessor=on",
    "project:",
    "  name: Shop - stage",
    "",
    ...services,
  ]);
});
