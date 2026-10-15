import { useEffect, useState, type ReactNode } from "react";

import { SpecimenBlock, SpecimenGrid } from "../Specimen";

/**
 * A home-made state section: one line counting what the app draws instead of the kit, then one
 * block per distinct look, each listing every place that look is defined.
 */
export function StateCensus({
  count,
  atom,
  children,
}: {
  /** "34 own definitions in 29 files, 8 looks". */
  readonly count: string;
  /** The kit atom these should have used. */
  readonly atom: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <p className="m-0 text-sm">
        {count} <span className="text-muted-foreground">Kit atom: {atom}.</span>
      </p>
      {children}
    </div>
  );
}

/** One distinct look: its name and how often the app draws it, its real components, its places. */
export function CensusLook({
  name,
  uses,
  places,
  children,
}: {
  readonly name: string;
  /** "11 sites in 6 files". */
  readonly uses: string;
  /** Every definition or inline site of this look, repository-relative with a line. */
  readonly places: readonly string[];
  readonly children: ReactNode;
}) {
  return (
    <SpecimenBlock title={`${name} · ${uses}`}>
      <SpecimenGrid>{children}</SpecimenGrid>
      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer">{places.length} places</summary>
        <ul className="m-0 mt-1 flex flex-col gap-0.5 ps-4">
          {places.map((place) => (
            <li key={place}>
              <code className="font-mono">{place}</code>
            </li>
          ))}
        </ul>
      </details>
    </SpecimenBlock>
  );
}

/**
 * The room a page-sized state is drawn in: a fixed frame, so a stage that fills its parent or sits
 * at its foot shows at a size you can compare beside the others.
 */
export function StateFrame({
  size = "card",
  children,
}: {
  readonly size?: "line" | "card" | "page";
  readonly children: ReactNode;
}) {
  const box =
    size === "page"
      ? "h-[560px] w-[760px]"
      : size === "card"
        ? "min-h-40 w-[440px]"
        : "min-h-12 w-[440px]";
  return (
    <div className={`relative flex min-w-0 flex-col overflow-hidden rounded-xl border ${box}`}>
      {children}
    </div>
  );
}

/** Now, every second: what a wait's clock reads from, so its elapsed time runs on the page. */
export function useKitNowMs(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return nowMs;
}
