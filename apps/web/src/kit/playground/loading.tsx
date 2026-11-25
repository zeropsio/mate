import { Loading, type LoadingShape } from "~/components/ui/loading";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

const SHAPES = variantsOf<LoadingShape>({
  rows: true,
  lines: true,
  cards: true,
  page: true,
  line: true,
  room: true,
});
// A count draws that many of a shape that repeats; `line` and `room` are one of themselves.
const COUNTED: ReadonlySet<LoadingShape> = new Set(["rows", "lines", "cards", "page"]);
const COUNTS = ["1", "2", "3", "5"] as const;

export default definePlayground({
  section: "loading",
  name: "Loading",
  imports: 'import { Loading } from "~/components/ui/loading";',
  controls: {
    shape: {
      kind: "enum",
      options: SHAPES,
      note: "shaped like what comes; room holds the place and paints nothing",
    },
    count: {
      kind: "enum",
      options: COUNTS,
      note: "rows, lines, cards, page: as many as are expected",
    },
    quiet: {
      kind: "boolean",
      note: "unpainted for the app's one hold, then in place; turn it on to replay",
    },
    label: { kind: "text", note: "what is on its way, for assistive technology" },
  },
  initial: { shape: "rows", count: "3", quiet: false, label: "Your projects" },
  render: ({ shape, count, quiet, label }) => (
    <div className="w-110 rounded-card border p-4">
      <Loading
        count={Number(count)}
        // A new key replays the hold from the first frame.
        key={`${shape}-${quiet}`}
        label={label}
        quiet={quiet}
        shape={shape}
      />
    </div>
  ),
  jsx: ({ shape, count, quiet, label }) =>
    jsxElement(
      "Loading",
      {
        label,
        shape,
        count: COUNTED.has(shape) && count !== "3" ? Number(count) : undefined,
        quiet,
      },
      undefined,
      { shape: "rows", quiet: false },
    ),
  usage: {
    do: [
      "Shape it like what will come, at its final size and place, so nothing moves when it lands.",
      "Give it the count expected, when the source says how many.",
      "Make a read that usually lands at once quiet, so it never paints a stand-in it takes back.",
      "Build a surface's own stand-in from Skeleton inside it, as its children.",
    ],
    dont: [
      "Write Loading… in the middle of a page, or put a Spinner where content will stand.",
      "Keep it after the source answered with nothing: that is an EmptyState.",
    ],
  },
});
