/**
 * The file finder's ranking: a typed name against every path at the commit HQ listed, its file
 * name before its folders — the picker's query rules and highlights, ranked here because no
 * server ranks a repository's paths.
 */
import {
  insertRankedSearchResult,
  scoreQueryMatch,
  type RankedSearchResult,
} from "@t3tools/shared/searchRanking";
import {
  filePickerMatch,
  normalizeFileQuery,
  type ProjectFilePickerMatch,
} from "~/components/files/ProjectFilePicker.logic";

/** Rows the finder shows at first and adds on each "Show more". */
export const FINDER_PAGE = 100;

const score = (path: string, query: string): number | null => {
  const lower = path.toLowerCase();
  const name = scoreQueryMatch({
    value: lower.slice(lower.lastIndexOf("/") + 1),
    query,
    exactBase: 0,
    prefixBase: 10,
    boundaryBase: 20,
    includesBase: 30,
    fuzzyBase: 200,
    boundaryMarkers: [".", "-", "_"],
  });
  const whole = scoreQueryMatch({
    value: lower,
    query,
    exactBase: 0,
    prefixBase: 40,
    boundaryBase: 50,
    includesBase: 60,
    fuzzyBase: 400,
    boundaryMarkers: ["/", ".", "-", "_"],
  });
  return name === null ? whole : whole === null ? name : Math.min(name, whole);
};

/**
 * The best `limit` paths for `rawQuery`, best first, and whether more match; with nothing typed,
 * the first `limit` paths in HQ's order.
 */
export function finderMatches(
  paths: ReadonlyArray<string>,
  rawQuery: string,
  limit: number,
): { readonly rows: ReadonlyArray<ProjectFilePickerMatch>; readonly more: boolean } {
  const query = normalizeFileQuery(rawQuery);
  if (query === "")
    return {
      rows: paths.slice(0, limit).map((path) => filePickerMatch(path, "")),
      more: paths.length > limit,
    };
  const ranked: Array<RankedSearchResult<string>> = [];
  for (const path of paths) {
    const at = score(path, query);
    if (at !== null)
      insertRankedSearchResult(ranked, { item: path, score: at, tieBreaker: path }, limit + 1);
  }
  return {
    rows: ranked.slice(0, limit).map(({ item }) => filePickerMatch(item, query)),
    more: ranked.length > limit,
  };
}
