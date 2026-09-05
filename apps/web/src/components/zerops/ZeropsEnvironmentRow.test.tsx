import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  ZEROPS_ENVIRONMENT_GRID,
  ZeropsEmptySeat,
  ZeropsEnvironmentRow,
  ZeropsEnvironmentTableHeader,
  ZeropsMateSeat,
  ZeropsMateVerb,
  ZeropsMateWord,
} from "./ZeropsEnvironmentRow";

const APP: ZeropsPublicRoute = {
  service: "app",
  port: 80,
  url: "https://app-26a7.prg1.zerops.app",
  host: "app-26a7.prg1.zerops.app",
};

function row(props: Partial<React.ComponentProps<typeof ZeropsEnvironmentRow>> = {}) {
  return renderToStaticMarkup(
    <ZeropsEnvironmentRow
      environmentName="acme-docs-dev"
      roleLabel="Dev"
      seat={<ZeropsMateSeat face="idle" name="Fen" tint="coral" />}
      {...props}
    />,
  );
}

describe("ZeropsEnvironmentRow", () => {
  it("is one row of the shared grid: seat, tag, environment, public access, activity, menu", () => {
    const html = row({ routes: [APP], activity: <ZeropsMateWord label="Idle" tone="off" /> });
    expect(html).toContain('role="row"');
    expect(html).toContain(ZEROPS_ENVIRONMENT_GRID.split(" ")[0]!);
    for (const cell of ["seat", "tag", "environment", "routes", "activity", "menu"]) {
      expect(html).toContain(`data-zerops-row-cell="${cell}"`);
    }
    expect(html).toContain(">Fen<");
    expect(html).toContain(">Dev<");
    expect(html).toContain("acme-docs-dev");
    expect(html).toContain(">app<");
    expect(html).toContain(">Idle<");
    expect(html.indexOf(">Fen<")).toBeLessThan(html.indexOf(">Dev<"));
    expect(html.indexOf(">Dev<")).toBeLessThan(html.indexOf("acme-docs-dev"));
  });

  it("shows a dash when the routes are known to be none, and nothing while unknown", () => {
    expect(row({ routes: [] })).toContain('data-zerops-surface="public-routes-empty"');
    const unknown = row();
    expect(unknown).not.toContain('data-zerops-surface="public-routes-empty"');
    // The cell is there either way, so the row keeps its shape.
    expect(unknown).toContain('data-zerops-row-cell="routes"');
  });

  it("puts the project's own trouble beside its name, never in the Mate's column", () => {
    const html = row({ status: <span data-test="status" /> });
    const environment = html.slice(
      html.indexOf('data-zerops-row-cell="environment"'),
      html.indexOf('data-zerops-row-cell="routes"'),
    );
    expect(environment).toContain('data-test="status"');
  });

  it("reveals the menu on hover and reads as a way in only when the seat opens", () => {
    const plain = row({ menu: <span data-test="menu" /> });
    expect(plain).toContain('data-test="menu"');
    expect(plain).toContain("group-hover/row:opacity-100");
    expect(plain).not.toContain("hover:bg-accent/50");
    expect(row({ opens: true })).toContain("hover:bg-accent/50");
  });
});

describe("the seat", () => {
  it("is the Mate's face and name, and stretches over the row when it opens", () => {
    const still = renderToStaticMarkup(<ZeropsMateSeat face="working" name="Fen" tint="sky" />);
    expect(still).toContain('data-mate-face-state="working"');
    expect(still).toContain('data-mate-face-tint="sky"');
    expect(still).not.toContain("<button");
    const opens = renderToStaticMarkup(
      <ZeropsMateSeat face="idle" name="Fen" onOpen={() => {}} tint="sky" />,
    );
    expect(opens).toContain('data-zerops-surface="mate-open"');
    expect(opens).toContain("after:absolute after:inset-0");
  });

  it("is a dash where a Mate is not for, and the one verb where it is", () => {
    const dash = renderToStaticMarkup(<ZeropsEmptySeat />);
    expect(dash).toContain('aria-label="No Mate"');
    expect(dash).not.toContain("<button");
    const verb = renderToStaticMarkup(<ZeropsEmptySeat label="Set up Mate" onClick={() => {}} />);
    expect(verb).toContain("<button");
    expect(verb).toContain('data-zerops-primary-action="Set up Mate"');
    expect(verb).toContain(">Set up Mate<");
  });
});

describe("the activity words", () => {
  it("takes a platform tone for a Mate whose socket is down", () => {
    const html = renderToStaticMarkup(<ZeropsMateWord label="Starting" tone="busy" />);
    expect(html).toContain("text-[var(--zerops-status-busy-text,var(--foreground))]");
    expect(html).toContain(">Starting<");
    // Read, not scanned: a word, not a label.
    expect(html).not.toContain("uppercase");
  });

  it("takes the thread status pill's own colour for a connected Mate, and pulses when told", () => {
    const html = renderToStaticMarkup(
      <ZeropsMateWord className="text-amber-600" label="Approval" pulse />,
    );
    expect(html).toContain("text-amber-600");
    expect(html).toContain("animate-status-pulse");
  });

  it("writes a verb in the acting colour", () => {
    const html = renderToStaticMarkup(<ZeropsMateVerb label="Connect" onClick={() => {}} />);
    expect(html).toContain("text-primary");
    expect(html).toContain('data-zerops-primary-action="Connect"');
  });
});

describe("ZeropsEnvironmentTableHeader", () => {
  it("names the columns once, in the row's own grid", () => {
    const html = renderToStaticMarkup(<ZeropsEnvironmentTableHeader />);
    expect(html).toContain('role="row"');
    expect(html.match(/role="columnheader"/gu)).toHaveLength(5);
    for (const column of ["Mate", "Tag", "Environment", "Public access", "Activity"]) {
      expect(html).toContain(`>${column}<`);
    }
    expect(html).toContain(ZEROPS_ENVIRONMENT_GRID.split(" ")[0]!);
    expect(renderToStaticMarkup(<ZeropsEnvironmentTableHeader lead="Tool" />)).toContain(">Tool<");
  });
});
