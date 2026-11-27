import { expect, it } from "vite-plus/test";
import { indexChangeNumbers, resolveChangeNumbers } from "./BareChangeNumber.logic.ts";

// witness: apps/web/src/components/zerops/BareChangeNumber.logic.ts | previous !== null && previous.repo !== change.repo → previous !== null && previous.repo === change.repo
it("MN118: A Mate's bare change number links to the one change carrying it in its application, while unknown or repository-ambiguous numbers stay text; breaks: a person opens the wrong review or a number that names no held change.", () => {
  const recipe = { repo: "recipe", number: 7 };
  const recent = { repo: "site", number: 9 };
  const changes = indexChangeNumbers([
    recipe,
    recipe, // navigation and held detail can name the same change
    recent,
    { repo: "site", number: 12 },
    { repo: "recipe", number: 12 },
  ]);
  expect(resolveChangeNumbers("Návrh #7, #999, #12 a #9.", changes)).toEqual([
    { text: "Návrh " },
    { text: "#7", change: recipe },
    { text: ", #999, #12 a " },
    { text: "#9", change: recent },
    { text: "." },
  ]);
  expect(resolveChangeNumbers("repo#7 #70 #7suffix #07", changes)).toEqual([
    { text: "repo#7 #70 #7suffix #07" },
  ]);
});
