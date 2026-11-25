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
  { name: "storefront", runtime: "Node.js 22", state: "Running", tone: "success" },
  { name: "db", runtime: "PostgreSQL 16", state: "Running", tone: "success" },
  { name: "cache", runtime: "Valkey 7.2", state: "Stopped", tone: "neutral" },
  { name: "worker", runtime: "Go 1.23", state: "Building", tone: "info" },
  { name: "search", runtime: "Meilisearch 1.9", state: "Failed", tone: "danger" },
] as const;
const LONG_NAME = "a-service-with-a-name-long-enough-to-wrap-or-truncate";

const ROWS = ["2", "3", "5"] as const;
const SELECTED = ["none", "1", "2"] as const;

export default definePlayground({
  section: "table",
  name: "Table",
  imports:
    'import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";',
  controls: {
    rows: { kind: "enum", options: ROWS, note: "like things, compared across the same columns" },
    state: { kind: "boolean", note: "a State column of Badges" },
    longName: { kind: "boolean", note: "the first name long enough to wrap" },
    selected: { kind: "enum", options: SELECTED, note: 'a row with data-state="selected"' },
    sticky: {
      kind: "boolean",
      note: "the header holds the top of the scrolling box the table sits in",
    },
  },
  initial: { rows: "3", state: true, longName: false, selected: "none", sticky: false },
  render: ({ rows, state, longName, selected, sticky }) => (
    <div
      className={
        sticky
          ? "h-36 w-[40rem] max-w-full overflow-auto rounded-card border"
          : "w-[40rem] max-w-full"
      }
    >
      <Table>
        <TableHeader sticky={sticky}>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead>Runtime</TableHead>
            {state ? <TableHead>State</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {SERVICES.slice(0, Number(rows)).map((service, index) => (
            <TableRow
              data-state={String(index + 1) === selected ? "selected" : undefined}
              key={service.name}
            >
              <TableCell>{longName && index === 0 ? LONG_NAME : service.name}</TableCell>
              <TableCell>{service.runtime}</TableCell>
              {state ? (
                <TableCell>
                  <Badge tone={service.tone}>{service.state}</Badge>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
  jsx: ({ rows, state, longName, selected, sticky }) => {
    const head = [
      "<TableHead>Service</TableHead>",
      "<TableHead>Runtime</TableHead>",
      ...(state ? ["<TableHead>State</TableHead>"] : []),
    ].join("\n");
    const body = SERVICES.slice(0, Number(rows))
      .map((service, index) =>
        jsxElement(
          "TableRow",
          { "data-state": String(index + 1) === selected ? "selected" : undefined },
          [
            `<TableCell>${longName && index === 0 ? LONG_NAME : service.name}</TableCell>`,
            `<TableCell>${service.runtime}</TableCell>`,
            ...(state
              ? [
                  `<TableCell>\n  <Badge tone="${service.tone}">${service.state}</Badge>\n</TableCell>`,
                ]
              : []),
          ].join("\n"),
        ),
      )
      .join("\n");
    return jsxElement(
      "Table",
      {},
      [
        jsxElement("TableHeader", { sticky }, jsxElement("TableRow", {}, head), { sticky: false }),
        jsxElement("TableBody", {}, body),
      ].join("\n"),
    );
  },
  usage: {
    do: [
      "Compare like things across the same columns: services by runtime and state, usage by day.",
      "Name a column by what it holds, in one or two words.",
      "Say a state in a Badge in its cell.",
      "Stick the header when the table scrolls in a box of its own height.",
    ],
    dont: [
      "Lay out a list of one kind of thing as a table: those are Rows.",
      "Put presses in every cell: a row's actions sit at its end.",
    ],
  },
});
