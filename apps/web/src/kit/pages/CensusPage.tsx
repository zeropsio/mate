import { useEffect, useRef, useState, type ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { Section } from "~/components/ui/section";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

import { watchIntersections } from "~/lib/restingIntersections";

import { KitViewer } from "../census";
import type { KitSection } from "../kitSection";
import { KIT_OMISSIONS } from "../omissions";
import { useKitSourceCounts } from "../shell/kitCounts";
import { SectionBoundary } from "./SectionBoundary";

export const NOT_SHOWN_ID = "not-shown";

/** Mounts its children once they come within a screen of the view, and keeps them. */
function LazyMount({ eager, children }: { readonly eager: boolean; readonly children: ReactNode }) {
  // Without an observer (a test's page) everything is drawn at once.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver !== "function");
  const holder = useRef<HTMLDivElement | null>(null);
  const shown = seen || eager;
  useEffect(() => {
    if (shown || holder.current === null) return;
    const watcher = watchIntersections(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: "800px 0px" },
    );
    if (watcher === undefined) return;
    watcher.observe(holder.current);
    return () => watcher.disconnect();
  }, [shown]);
  return shown ? children : <div className="min-h-64" ref={holder} />;
}

/**
 * The census's line under its title: how many looks the app still draws for itself, the number
 * the kit drives to zero.
 */
export function CensusSummary({ sections }: { readonly sections: readonly KitSection[] }) {
  const counts = useKitSourceCounts();
  const homeMade = sections.filter((section) => section.group === "Home-made");
  return (
    <span className="flex items-center gap-2">
      <Badge tone="warning">{counts === undefined ? "…" : `${counts.looks} looks`}</Badge>
      <span>
        in {homeMade.length} sections, each one a look to move onto the kit until the census is
        empty.
      </span>
    </span>
  );
}

/**
 * Every home-made section, each mounted as it nears the view, then what the kit leaves out. `at`
 * brings one section (or the omissions) into view, mounting everything above it first.
 */
export function CensusBody({
  sections,
  at,
}: {
  readonly sections: readonly KitSection[];
  readonly at: string | undefined;
}) {
  const counts = useKitSourceCounts();
  const homeMade = sections.filter((section) => section.group === "Home-made");
  const target = at === NOT_SHOWN_ID ? homeMade.length : homeMade.findIndex(({ id }) => id === at);

  useEffect(() => {
    if (at === undefined) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`census-${at}`)?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [at]);

  return (
    <KitViewer>
      <div className="flex flex-col gap-16 p-8">
        {homeMade.map((section, index) => {
          const looks = counts?.looksBySection.get(section.id);
          return (
            <div className="scroll-mt-6" id={`census-${section.id}`} key={section.id}>
              <Section
                count={looks === undefined || looks === 0 ? undefined : `${looks} looks`}
                title={section.title}
              >
                <p className="m-0 text-body text-muted-foreground">{section.purpose}</p>
                <div className="pt-4">
                  <LazyMount eager={index <= target}>
                    <SectionBoundary section={section} />
                  </LazyMount>
                </div>
              </Section>
            </div>
          );
        })}
        <div className="scroll-mt-6" id={`census-${NOT_SHOWN_ID}`}>
          <Section count={KIT_OMISSIONS.length} title="Not shown">
            <p className="m-0 text-body text-muted-foreground">
              Components the kit leaves out, and why.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Export</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {KIT_OMISSIONS.map((omission) => (
                  <TableRow key={omission.name}>
                    <TableCell>
                      <code className="font-mono text-caption">{omission.name}</code>
                    </TableCell>
                    <TableCell>
                      <code className="font-mono text-caption text-muted-foreground">
                        {omission.source}
                      </code>
                    </TableCell>
                    <TableCell>{omission.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        </div>
      </div>
    </KitViewer>
  );
}
