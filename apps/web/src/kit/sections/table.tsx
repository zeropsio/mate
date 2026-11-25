import { Badge } from "~/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

const ROWS = [
  { name: "storefront", runtime: "Node.js 22", state: "Running", tone: "success" as const },
  { name: "db", runtime: "PostgreSQL 16", state: "Running", tone: "success" as const },
  { name: "cache", runtime: "Valkey 7.2", state: "Stopped", tone: "neutral" as const },
  {
    name: "a-service-with-a-name-long-enough-to-wrap-or-truncate",
    runtime: "Go 1.23",
    state: "Needs attention",
    tone: "warning" as const,
  },
];

const PEOPLE = [
  { name: "Ada Lovelace", levels: ["Full", "Full", "Read"] },
  { name: "Karel Novák", levels: ["Read", "Full", "Full"] },
  { name: "Eva Dvořák", levels: ["–", "Full", "Read"] },
];

export default defineKitSection({
  id: "table",
  title: "Table",
  purpose: "Rows of like things compared across the same columns.",
  group: "Kit",
  kind: "Data",
  source: "apps/web/src/components/ui/table.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="Like things across the same columns, a long name among them."
        title="A table"
      >
        <SpecimenGrid size="xl">
          <Specimen
            align="start"
            label="<Table> · <TableHeader> · <TableBody> · <TableRow> · <TableHead> · <TableCell>"
            span="row"
          >
            <div className="w-full max-w-[40rem]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Runtime</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ROWS.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.runtime}</TableCell>
                      <TableCell>
                        <Badge tone={row.tone}>{row.state}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="Headers that stay put while the body scrolls under or beside them."
        title="Sticky headers"
      >
        <SpecimenGrid size="xl">
          <Specimen
            label='<TableHeader sticky> · <TableRow data-state="selected">'
            note="A header row over a scrolling body, one row selected"
          >
            <div className="h-36 w-full max-w-[40rem] overflow-auto rounded-card border">
              <Table>
                <TableHeader sticky>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Runtime</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...ROWS, ...ROWS].map((row, index) => (
                    <TableRow
                      data-state={index === 1 ? "selected" : undefined}
                      key={`${row.name}-${index}`}
                    >
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.runtime}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Specimen>
          <Specimen
            label='<Table size="md"> · <TableHead scope="row" sticky>'
            note="A first column that stays on its ground, scrolled sideways"
          >
            <div className="w-full max-w-80 rounded-card border bg-card">
              <Table size="md">
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-36" sticky>
                      <span className="sr-only">Person</span>
                    </TableHead>
                    <TableHead className="min-w-28">Production</TableHead>
                    <TableHead className="min-w-28">Stage</TableHead>
                    <TableHead className="min-w-28">Preview</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PEOPLE.map((person) => (
                    <TableRow key={person.name}>
                      <TableHead className="min-w-36" scope="row" sticky>
                        {person.name}
                      </TableHead>
                      {person.levels.map((level, index) => (
                        <TableCell key={index}>{level}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
