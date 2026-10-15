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
import { Specimen } from "../Specimen";

const ROWS = [
  { name: "storefront", runtime: "Node.js 22", state: "Running", variant: "success" as const },
  { name: "db", runtime: "PostgreSQL 16", state: "Running", variant: "success" as const },
  { name: "cache", runtime: "Valkey 7.2", state: "Stopped", variant: "secondary" as const },
  {
    name: "a-service-with-a-name-long-enough-to-wrap-or-truncate",
    runtime: "Go 1.23",
    state: "Needs attention",
    variant: "warning" as const,
  },
];

export default defineKitSection({
  id: "table",
  title: "Table",
  purpose: "Rows of like things compared across the same columns.",
  group: "Kit",
  kind: "Data",
  source: "apps/web/src/components/ui/table.tsx",
  render: () => (
    <Specimen label="<Table> · <TableHeader> · <TableBody> · <TableRow> · <TableHead> · <TableCell>">
      <div className="w-[40rem] max-w-full">
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
                  <Badge variant={row.variant}>{row.state}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Specimen>
  ),
});
