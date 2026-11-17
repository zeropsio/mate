import { expect, it } from "vite-plus/test";

import { homeOverviewSearch } from "./homeLanding.logic";

const own = { mine: true } as const;
const colleagues = { mine: false } as const;

it.each([
  ["a Mate of the reader's own", { "proj-quill": colleagues, "proj-fern": own }, { show: "mine" }],
  ["only colleagues' Mates", { "proj-quill": colleagues }, {}],
  ["only the reader's own Chief", { "proj-chief": { mine: true, chief: "mine" } }, {}],
  ["no Mate HQ places", {}, {}],
] as const)(
  "The empty link opens the overview on Mine when HQ places a Mate of the reader's own, else on All: %s",
  (_case, facts, search) => {
    expect(homeOverviewSearch(facts)).toEqual(search);
  },
);
