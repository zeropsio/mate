import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { PortalGate } from "../ui/portal-gate";
import { SheetPopup } from "../ui/sheet";
import {
  MatePeekCard,
  MatePeekHost,
  useMatePeekKeys,
  type MatePeekCardProps,
} from "./SidebarMatePeek";
import { askedLabelFor, type MatePeekChoice } from "./SidebarMatePeek.logic";

const card = (props: Partial<MatePeekCardProps> = {}) =>
  renderToStaticMarkup(
    <MatePeekCard
      appUrl="https://nova-app.example"
      askedLabel="You asked"
      change={<span>#14 Add a /status page</span>}
      decision={undefined}
      face="working"
      lastWords="The handler reads the build number from the environment."
      name="Nova"
      onChoose={() => {}}
      onOpen={() => {}}
      onStop={undefined}
      onText={() => {}}
      projectName="Storefront"
      responding={false}
      steps={[
        { text: "Read the routes", state: "done" },
        { text: "Run the build", state: "running" },
        { text: undefined, state: "waiting" },
      ]}
      stepsLabel="Plan"
      task="Add a /status page that shows the build number"
      time={<span>3:12</span>}
      tint="sky"
      waitingOn={undefined}
      {...props}
    />,
  );
const sections = (html: string) =>
  [...html.matchAll(/data-zerops-peek-section="([^"]+)"/gu)].map((match) => match[1]);

describe("MatePeekCard — a Mate at a glance", () => {
  it("says what you asked, the plan, its last words and its change, in that order", () => {
    const html = card();
    expect(sections(html)).toEqual(["task", "plan", "last-words", "change"]);
    expect(html).toContain(">You asked<");
    expect(html).toContain(">Plan<");
    expect(html).toContain(">Last words<");
    expect(html).toContain(">Change<");
    // No word says what the face shows.
    expect(html).not.toContain(">Working<");
  });

  it("marks each step done, running or waiting, and holds a waiting step's place until it is read", () => {
    const html = card();
    expect(html.match(/data-zerops-peek-step="done"/gu)).toHaveLength(1);
    expect(html.match(/data-zerops-peek-step="running"/gu)).toHaveLength(1);
    expect(html.match(/data-zerops-peek-step="waiting"/gu)).toHaveLength(1);
    expect(html).toContain('data-slot="skeleton"');
  });

  it("offers Open with its key and the Mate's app as a link, and leaves out what is not there", () => {
    const html = card();
    expect(html).toMatch(/>Open<kbd[^>]*>↵<\/kbd>/u);
    expect(html).toMatch(/<a[^>]*href="https:\/\/nova-app\.example"[^>]*target="_blank"/u);
    const bare = card({ appUrl: undefined, task: undefined, steps: undefined, change: undefined });
    expect(bare).not.toContain("Open app");
    expect(sections(bare)).toEqual(["last-words"]);
  });

  it("offers Stop with its key while it works", () => {
    expect(card({ onStop: () => {} })).toMatch(/>Stop<kbd[^>]*>X<\/kbd>/u);
    expect(card()).not.toContain(">Stop<");
  });
});

describe("askedLabelFor — whose ask it was", () => {
  it.each([
    { owner: { name: "Ales Rechtorik", isViewer: true }, label: "You asked" },
    { owner: { name: "Petra Malá", isViewer: false }, label: "Petra asked" },
    { owner: undefined, label: "Asked" },
  ])("reads $owner as $label", ({ owner, label }) => {
    expect(askedLabelFor(owner)).toBe(label);
  });
});

describe("MatePeekCard — what the Mate waits on, answered in place", () => {
  const question = {
    kind: "question" as const,
    requestId: "req-2",
    questionId: "discount",
    question: "Should the 10% come off the shipping too?",
    choices: [
      { label: "Only the items", value: "items", primary: false },
      { label: "Items and shipping", value: "all", primary: false },
    ],
    allowText: true,
  };
  const approval = {
    kind: "approval" as const,
    requestId: "req-1",
    title: "Juno wants to run",
    detail: "psql -c 'DROP TABLE scores_legacy;'",
    choices: [
      { label: "Approve", value: "accept", primary: true },
      { label: "Deny", value: "decline", primary: false },
    ],
  };
  const choices = (html: string) =>
    [...html.matchAll(/data-zerops-peek-choice="(\d)"/gu)].map((match) => Number(match[1]));

  it("asks its question in place of its last words, each option numbered, with a field for words", () => {
    const html = card({ decision: question, name: "Kai" });
    expect(sections(html)).toContain("decision");
    expect(sections(html)).not.toContain("last-words");
    expect(html).toContain(">Kai asks<");
    expect(choices(html)).toEqual([1, 2]);
    expect(html).toMatch(/data-zerops-primitive="key-chip"[^>]*>1</u);
    expect(html).toContain('id="sidebar-peek-answer"');
    expect(card({ decision: { ...question, allowText: false } })).not.toContain(
      "sidebar-peek-answer",
    );
  });

  it("shows the command it wants to run word for word, Approve first and filled", () => {
    const html = card({ decision: approval, name: "Juno" });
    expect(html).toMatch(
      /<pre[^>]*font-mono[^>]*>psql -c &#x27;DROP TABLE scores_legacy;&#x27;<\/pre>/u,
    );
    expect(choices(html)).toEqual([1, 2]);
    expect(html.indexOf(">Approve<")).toBeLessThan(html.indexOf(">Deny<"));
  });

  it("shows another member's Mate's question with who it waits for, and no way to answer it", () => {
    const html = card({ decision: question, name: "Kai", waitingOn: "Petra" });
    expect(html).toContain("Should the 10% come off the shipping too?");
    expect(choices(html)).toEqual([]);
    expect(html).not.toContain("sidebar-peek-answer");
    expect(html).toContain("Waiting for Petra: only they can answer Kai.");
  });

  it("holds the choices while an answer is on its way", () => {
    const html = card({ decision: question, responding: true });
    const buttons = html.match(/<button[^>]*data-zerops-peek-choice[^>]*>/gu) ?? [];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toContain('disabled=""');
  });

  it.each([
    {
      decision: { kind: "failure" as const, message: "The deploy timed out." },
      says: "The deploy timed out.",
    },
    {
      decision: { kind: "failure" as const, message: undefined },
      says: "Its last run stopped with an error.",
    },
    { decision: { kind: "plan" as const }, says: "It waits for you to look at its plan" },
    {
      decision: { kind: "questions" as const, question: "Which regions?", count: 2 },
      says: "2 questions",
    },
  ])("says what it can of a $decision.kind it leaves to the conversation", ({ decision, says }) => {
    expect(card({ decision })).toContain(says);
  });

  it("holds the question's place while it is read", () => {
    const html = card({ decision: { kind: "reading" }, name: "Kai" });
    expect(html).toContain(">Kai waits on you<");
    expect(html.match(/data-slot="skeleton"/gu)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe("useMatePeekKeys — the peek's keys, wherever it stands", () => {
  const CHOICES: ReadonlyArray<MatePeekChoice> = [
    { label: "Sink to the bottom", value: "sink", primary: false },
    { label: "Hide behind a toggle", value: "hide", primary: false },
  ];
  let mounted: ReactTestRenderer | undefined;
  afterEach(() => {
    act(() => {
      mounted?.unmount();
    });
    vi.unstubAllGlobals();
  });
  function Keys(props: Parameters<typeof useMatePeekKeys>[0]) {
    useMatePeekKeys(props);
    return null;
  }
  const press = (key: string, extra: Record<string, unknown> = {}) => {
    const event = Object.assign(new Event("keydown", { cancelable: true }), { key, ...extra });
    act(() => {
      window.dispatchEvent(event);
    });
    return event.defaultPrevented;
  };
  const keys = (answerable: boolean, canStop = true) => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("HTMLElement", function none() {});
    const done = { chose: [] as string[], stopped: 0, closed: 0 };
    act(() => {
      mounted = create(
        <Keys
          answerable={answerable}
          choices={CHOICES}
          onChoose={(choice) => {
            done.chose.push(choice.value);
          }}
          onClose={() => {
            done.closed += 1;
          }}
          onStop={
            canStop
              ? () => {
                  done.stopped += 1;
                }
              : undefined
          }
        />,
      );
    });
    return done;
  };

  it.each([
    { case: "a number picks its choice", key: "2", answerable: true, chose: ["hide"], taken: true },
    {
      case: "a number past the choices is nobody's",
      key: "3",
      answerable: true,
      chose: [],
      taken: false,
    },
    {
      case: "a number where it may not answer is nobody's",
      key: "1",
      answerable: false,
      chose: [],
      taken: false,
    },
  ])("$case", ({ key, answerable, chose, taken }) => {
    const done = keys(answerable);
    expect(press(key)).toBe(taken);
    expect(done.chose).toEqual(chose);
  });

  it("stops the run on x, puts the peek away on Escape, and leaves a modified key alone", () => {
    const done = keys(true);
    press("x");
    press("Escape");
    press("1", { metaKey: true });
    expect(done).toEqual({ chose: [], stopped: 1, closed: 1 });
  });

  it("does not stop a Mate at rest", () => {
    const done = keys(true, false);
    expect(press("x")).toBe(false);
    expect(done.stopped).toBe(0);
  });
});

describe("MatePeekHost — where the peek stands", () => {
  let mounted: ReactTestRenderer | undefined;
  afterEach(() => {
    act(() => {
      mounted?.unmount();
    });
  });

  it("rises as a sheet on a phone with no cross over the card's time", () => {
    act(() => {
      mounted = create(
        <PortalGate closed>
          <MatePeekHost
            anchor={() => null}
            onClose={() => {}}
            onInteract={() => {}}
            onPointerEnter={() => {}}
            onPointerLeave={() => {}}
            open
            phone
            title="Vera, at a glance"
          >
            <span data-card="">card</span>
          </MatePeekHost>
        </PortalGate>,
      );
    });
    const sheet = mounted!.root.findByType(SheetPopup);
    expect(sheet.props.showCloseButton).toBe(false);
    expect(sheet.props["data-zerops-surface"]).toBe("sidebar-mate-peek-popup");
  });
});
