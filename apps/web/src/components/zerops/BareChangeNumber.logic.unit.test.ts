import { expect, it } from "vite-plus/test";
import {
  blockChange,
  changeActionOf,
  indexChangeNumbers,
  resolveChangeNumbers,
} from "./BareChangeNumber.logic.ts";

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

// witness: apps/web/src/components/zerops/BareChangeNumber.logic.ts | return named.size === 1 ? [...named.values()][0] : undefined; → return [...named.values()][0];
it("MN+1: A Mate's bold Open draft or Add to your app is a press of the one change its paragraph names, in any case, and stays words where the paragraph names none or two; breaks: a person opens another change's draft or review from the chat", () => {
  const seven = { repo: "site", number: 7 };
  const changes = indexChangeNumbers([seven, { repo: "site", number: 9 }]);
  const said = "Návrh #7 je v Mate pod Open draft. Add to your app návrh zkontroluje.";
  expect(blockChange(said, changes)).toEqual(seven);
  expect(blockChange("#7 a znovu #7, Open draft", changes)).toEqual(seven);
  expect(blockChange("#7 a #9: Open draft", changes)).toBeUndefined();
  expect(blockChange("Open draft", changes)).toBeUndefined();
  expect(blockChange("#999 Open draft", changes)).toBeUndefined();
  expect(["Open draft", "add to your app", "Your app"].map(changeActionOf)).toEqual([
    "draft",
    "add",
    undefined,
  ]);
});
