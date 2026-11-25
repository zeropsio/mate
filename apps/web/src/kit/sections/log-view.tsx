import { LogView, type LogLine } from "~/components/ui/code-block";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

export const KIT_LOG: ReadonlyArray<LogLine> = [
  { id: "1", time: "14:02:11", text: "Pulling nodejs@22 base image" },
  { id: "2", time: "14:02:14", text: "pnpm install --frozen-lockfile" },
  { id: "3", time: "14:02:31", text: "Packages: +1284", tone: "quiet" },
  {
    id: "4",
    time: "14:02:33",
    text: "WARN  deprecated inflight@1.0.6: This module is not supported, and leaks memory.",
    tone: "warning",
  },
  { id: "5", time: "14:02:40", text: "pnpm build" },
  {
    id: "6",
    time: "14:02:52",
    text: "src/server.ts(41,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    tone: "failed",
  },
  {
    id: "7",
    time: "14:02:52",
    text: "Build failed: the command exited with code 2.",
    tone: "failed",
  },
];

const UNTIMED: ReadonlyArray<LogLine> = KIT_LOG.map(({ time: _time, ...line }) => line);

export default defineKitSection({
  id: "log-view",
  title: "LogView",
  purpose: "Lines a machine wrote one by one: a build's log, a service's log, a failed tail.",
  group: "Kit",
  kind: "Data",
  source: "apps/web/src/components/ui/code-block.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="A failed line tinted across the whole width, a warning in its ink, times in a column."
        title="Lines"
      >
        <SpecimenGrid size="lg">
          <Specimen align="start" label='label="Build log" copy="the log"' note="Timed lines">
            <LogView className="w-full" copy="the log" label="Build log" lines={KIT_LOG} />
          </Specimen>
          <Specimen align="start" label='label="Log of api"' note="Lines without times">
            <LogView className="w-full" label="Log of api" lines={UNTIMED} />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="A streaming log stands in a fixed pane, following its newest line."
        title="Heights"
      >
        <SpecimenGrid size="lg">
          <Specimen align="start" label='height="sm" live'>
            <LogView
              className="w-full"
              height="sm"
              label="Live log"
              lines={[...KIT_LOG, ...KIT_LOG.map((line) => ({ ...line, id: `again-${line.id}` }))]}
              live
            />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
