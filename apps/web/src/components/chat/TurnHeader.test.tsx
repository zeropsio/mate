import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { TurnTallyItem } from "./MessagesTimeline.logic";
import { deriveTurnVerdict, TurnHeaderCard, TurnTally, type TurnHeaderRow } from "./TurnHeader";

const deployed: TurnTallyItem = {
  key: "service:nextstorestage",
  kind: "deploy",
  subject: "nextstorestage",
  facts: [
    { word: "Deployed", tone: "ok" },
    { word: "Healthy", tone: "ok" },
  ],
};
const deployedOnly: TurnTallyItem = {
  ...deployed,
  facts: [{ word: "Deployed", tone: "ok" }],
};
const verifiedOnly: TurnTallyItem = {
  key: "service:appdev",
  kind: "verify",
  subject: "appdev",
  facts: [{ word: "Healthy", tone: "ok" }],
};
const deployFailed: TurnTallyItem = {
  ...deployed,
  facts: [{ word: "Failed", tone: "failed" }],
};
const browserWithErrors: TurnTallyItem = {
  key: "browser",
  kind: "browser",
  subject: null,
  facts: [
    { word: "3 browser checks", tone: "attention" },
    { word: "1 with errors", tone: "failed" },
  ],
};
const browserOk: TurnTallyItem = {
  key: "browser",
  kind: "browser",
  subject: null,
  facts: [{ word: "6 browser checks", tone: "ok" }],
};
const landed: TurnTallyItem = {
  key: "landed:14",
  kind: "landed",
  subject: null,
  facts: [{ word: "nextstoredev #14 landed", tone: "ok" }],
};
const asks: TurnTallyItem = {
  key: "asks",
  kind: "asks",
  subject: null,
  facts: [{ word: "9 asks", tone: null }],
};

const settledRow = (overrides: Partial<TurnHeaderRow> = {}): TurnHeaderRow => ({
  kind: "turn-header",
  id: "turn-header:u1",
  createdAt: "2026-09-25T10:00:00.000Z",
  turnId: null,
  state: "settled",
  liveSince: null,
  activity: null,
  endedAt: "2026-09-25T11:51:27.000Z",
  duration: "1h 51m 27s",
  interrupted: false,
  fold: null,
  tally: [],
  ...overrides,
});

describe("deriveTurnVerdict", () => {
  it.each([
    { name: "a live turn", state: "live", tally: [deployFailed], expected: ["busy", "Working"] },
    { name: "nothing settled", state: "settled", tally: [], expected: ["off", "Done"] },
    { name: "only asks", state: "settled", tally: [asks], expected: ["off", "Done"] },
    {
      name: "browser checks alone",
      state: "settled",
      tally: [browserOk],
      expected: ["off", "Done"],
    },
    { name: "a landing", state: "settled", tally: [asks, landed], expected: ["ok", "Landed"] },
    {
      name: "a deploy without its verify",
      state: "settled",
      tally: [deployedOnly, landed],
      expected: ["ok", "Deployed"],
    },
    {
      name: "a verify without a deploy",
      state: "settled",
      tally: [verifiedOnly],
      expected: ["off", "Done"],
    },
    {
      name: "a deploy verified healthy",
      state: "settled",
      tally: [browserOk, deployed, landed],
      expected: ["ok", "Deployed · Healthy"],
    },
    {
      name: "a failed deploy",
      state: "settled",
      tally: [deployFailed, landed],
      expected: ["failed", "Needs attention"],
    },
    {
      name: "browser checks with errors beside a healthy deploy",
      state: "settled",
      tally: [deployed, browserWithErrors],
      expected: ["failed", "Needs attention"],
    },
    {
      name: "a stopped turn",
      state: "settled",
      interrupted: true,
      tally: [deployed],
      expected: ["off", "Stopped"],
    },
  ] as const)("reads $name", ({ state, tally, expected, ...rest }) => {
    const verdict = deriveTurnVerdict({
      state,
      interrupted: "interrupted" in rest ? rest.interrupted : false,
      tally,
    });
    expect([verdict.tone, verdict.word]).toEqual(expected);
  });
});

describe("TurnTally", () => {
  it("renders nothing before anything has settled", () => {
    expect(renderToStaticMarkup(<TurnTally items={[]} />)).toBe("");
  });

  it.each([
    {
      name: "a service's deploy and verify",
      item: deployed,
      chip: "nextstorestage · Deployed · Healthy",
      tone: "ok",
    },
    {
      name: "browser checks with errors",
      item: browserWithErrors,
      chip: "3 browser checks · 1 with errors",
      tone: "failed",
    },
    { name: "a landing", item: landed, chip: "nextstoredev #14 landed", tone: "ok" },
    { name: "asks", item: asks, chip: "9 asks", tone: null },
  ])("writes $name as one chip with its worst tone", ({ item, chip, tone }) => {
    const html = renderToStaticMarkup(<TurnTally items={[item]} />);
    const chips = [...html.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map(([, inner]) => inner ?? "");

    expect(chips).toHaveLength(1);
    expect(chips[0]!.replace(/<[^>]+>/g, "")).toBe(chip);
    const tones = [...chips[0]!.matchAll(/data-zerops-status-tone="([a-z]+)"/g)].map(
      ([, found]) => found,
    );
    expect(tones).toEqual(tone === null ? [] : [tone]);
  });

  it("keeps earlier chips in place as later facts append", () => {
    const before = renderToStaticMarkup(<TurnTally items={[browserOk, deployed]} />);
    const after = renderToStaticMarkup(<TurnTally items={[browserOk, deployed, landed]} />);

    expect(after.startsWith(before.replace(/<\/ul>$/, ""))).toBe(true);
  });
});

describe("TurnHeaderCard", () => {
  it("writes a settled turn as a card: verdict, duration, the fold control and its facts", () => {
    const html = renderToStaticMarkup(
      <TurnHeaderCard
        row={settledRow({ fold: { expanded: false }, tally: [browserOk, deployed, landed] })}
        clock={null}
        activityLabel={null}
        timestamp={<span>11:51</span>}
        onToggleFold={() => undefined}
      />,
    );

    expect(html).toContain('data-zerops-primitive="flat-card"');
    expect(html).toMatch(/data-zerops-status-tone="ok"[^>]*>.*?Deployed · Healthy/);
    expect(html).toContain(">1h 51m 27s<");
    expect(html).toContain("<span>11:51</span>");
    expect(html).toMatch(
      /<button[^>]*aria-expanded="false"[^>]*aria-label="Show this turn&#x27;s work"/,
    );
    expect([...html.matchAll(/<li/g)]).toHaveLength(3);
  });

  it("offers no fold control where the turn folds nothing away", () => {
    const html = renderToStaticMarkup(
      <TurnHeaderCard
        row={settledRow()}
        clock={null}
        activityLabel={null}
        timestamp={null}
        onToggleFold={null}
      />,
    );

    expect(html).not.toContain("<button");
    expect(html).toMatch(/data-zerops-status-tone="off"[^>]*>.*?Done/);
  });

  it("writes a live turn as the same card, a still dot, its clock and what runs now", () => {
    const html = renderToStaticMarkup(
      <TurnHeaderCard
        row={settledRow({
          state: "live",
          liveSince: "2026-09-25T10:00:00.000Z",
          endedAt: null,
          duration: null,
          tally: [browserOk],
        })}
        clock={<span>4:02</span>}
        activityLabel="Running ssh"
        timestamp={null}
        onToggleFold={null}
      />,
    );

    expect(html).toContain('data-zerops-primitive="flat-card"');
    expect(html).toMatch(/data-zerops-status-tone="busy"[^>]*>.*?Working/);
    expect(html).not.toContain("animate-");
    expect(html).toContain("<span>4:02</span>");
    expect(html).toContain(">Running ssh<");
  });
});
