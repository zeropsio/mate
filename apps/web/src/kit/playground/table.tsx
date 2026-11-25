import { Badge } from "~/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

import { definePlayground, jsxElement } from "../kitPlayground";

const SERVICES = [
  {
    name: "storefront",
    runtime: "Node.js 22",
    state: "Running",
    tone: "success",
    memory: "412 MB",
  },
  { name: "db", runtime: "PostgreSQL 16", state: "Running", tone: "success", memory: "1.2 GB" },
  { name: "cache", runtime: "Valkey 7.2", state: "Stopped", tone: "neutral", memory: "0 MB" },
  { name: "worker", runtime: "Go 1.23", state: "Building", tone: "info", memory: "96 MB" },
  { name: "search", runtime: "Meilisearch 1.9", state: "Failed", tone: "danger", memory: "38 MB" },
] as const;
const LONG_NAME = "a-service-with-a-name-long-enough-to-wrap-or-truncate";

const ROWS = ["2", "3", "5"] as const;
const SIZES = ["sm", "md"] as const;
const SELECTED = ["none", "1", "2"] as const;

export default definePlayground({
  section: "table",
  name: "Table",
  imports:
    'import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";',
  controls: {
    rows: { kind: "enum", options: ROWS, note: "like things, compared across the same columns" },
    state: { kind: "boolean", note: "a State column of Badges" },
    figures: { kind: "boolean", note: 'a Memory column of figures, align="end"' },
    longName: { kind: "boolean", note: "the first name long enough to wrap" },
    selected: { kind: "enum", options: SELECTED, note: 'a row with data-state="selected"' },
    sticky: {
      kind: "boolean",
      note: "the header holds the top of the scrolling box the table sits in",
    },
    stickyColumn: {
      kind: "boolean",
      note: "the first column stays as the rest scroll sideways under it",
    },
    size: { kind: "enum", options: SIZES, note: "sm a dense table of facts, md people or places" },
  },
  initial: {
    rows: "3",
    state: true,
    figures: false,
    longName: false,
    selected: "none",
    sticky: false,
    stickyColumn: false,
    size: "sm",
  },
  render: ({ rows, state, figures, longName, selected, sticky, stickyColumn, size }) => (
    <div
      className={
        sticky
          ? "h-36 w-[40rem] max-w-full overflow-auto rounded-card border"
          : stickyColumn
            ? "w-64 max-w-full rounded-card border bg-card"
            : "w-[40rem] max-w-full"
      }
    >
      <Table size={size}>
        <TableHeader sticky={sticky}>
          <TableRow>
            <TableHead sticky={stickyColumn}>Service</TableHead>
            <TableHead>Runtime</TableHead>
            {state ? <TableHead>State</TableHead> : null}
            {figures ? <TableHead align="end">Memory</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {SERVICES.slice(0, Number(rows)).map((service, index) => (
            <TableRow
              data-state={String(index + 1) === selected ? "selected" : undefined}
              key={service.name}
            >
              <TableHead scope="row" sticky={stickyColumn}>
                {longName && index === 0 ? LONG_NAME : service.name}
              </TableHead>
              <TableCell>{service.runtime}</TableCell>
              {state ? (
                <TableCell>
                  <Badge tone={service.tone}>{service.state}</Badge>
                </TableCell>
              ) : null}
              {figures ? <TableCell align="end">{service.memory}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
  jsx: ({ rows, state, figures, longName, selected, sticky, stickyColumn, size }) => {
    const first = stickyColumn ? "TableHead sticky" : "TableHead";
    const head = [
      `<${first}>Service</TableHead>`,
      "<TableHead>Runtime</TableHead>",
      ...(state ? ["<TableHead>State</TableHead>"] : []),
      ...(figures ? ['<TableHead align="end">Memory</TableHead>'] : []),
    ].join("\n");
    const body = SERVICES.slice(0, Number(rows))
      .map((service, index) =>
        jsxElement(
          "TableRow",
          { "data-state": String(index + 1) === selected ? "selected" : undefined },
          [
            `<${first} scope="row">${longName && index === 0 ? LONG_NAME : service.name}</TableHead>`,
            `<TableCell>${service.runtime}</TableCell>`,
            ...(state
              ? [
                  `<TableCell>\n  <Badge tone="${service.tone}">${service.state}</Badge>\n</TableCell>`,
                ]
              : []),
            ...(figures ? [`<TableCell align="end">${service.memory}</TableCell>`] : []),
          ].join("\n"),
        ),
      )
      .join("\n");
    return jsxElement(
      "Table",
      { size },
      [
        jsxElement("TableHeader", { sticky }, jsxElement("TableRow", {}, head), { sticky: false }),
        jsxElement("TableBody", {}, body),
      ].join("\n"),
      { size: "sm" },
    );
  },
  usage: {
    do: [
      "Compare like things across the same columns: services by runtime and state, usage by day.",
      "Name a column by what it holds, in one or two words.",
      "Say a state in a Badge in its cell.",
      "Stick the header when the table scrolls in a box of its own height.",
      "Stick the first column when the table is wider than its place and its rows are named there.",
      "Set --table-ground on a surface whose ground is not the card's, so what sticks stands on it.",
    ],
    dont: [
      "Lay out a list of one kind of thing as a table: those are Rows.",
      "Put presses in every cell: a row's actions sit at its end.",
    ],
  },
});
