// @effect-diagnostics nodeBuiltinImport:off -- exercises the shared motion wait in disposable Chrome pages.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { openBrowser } from "../harness/browser.ts";
import { waitForStillFrames } from "../harness/stillFrames.ts";

it.each([
  "delayed transition",
  "scroll between still frames",
  "infinite decoration",
  "fold hold",
  "timeline head hold",
])("waits for consecutive still geometry frames after the phase starts (%s)", async (motion) => {
  const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-still-"));
  await NodeFSP.writeFile(
    dist + "/index.html",
    `<!doctype html>
      <style>#surface { width: 100px; height: 100px; overflow: auto }
      #content { height: 500px } @keyframes spin { to { transform: rotate(360deg) } }
      #decoration { animation: spin 1s linear infinite }</style>
      <div id="surface"><div id="content"></div></div><div id="decoration">spin</div>`,
  );
  const web = await openBrowser(dist, {});
  try {
    await web.page.goto(web.origin);
    await web.page.evaluate((motion) => {
      const surface = document.querySelector<HTMLElement>("#surface")!;
      let frame = 0;
      const advance = () => {
        frame++;
        if (frame === 8) surface.dataset.started = "true";
        if (frame === 8 && motion === "fold hold") surface.dataset.runFold = "folding";
        if (frame === 8 && motion === "timeline head hold") surface.dataset.timelineHoldsHead = "";
        if (frame === 24) delete surface.dataset.runFold;
        if (frame === 24) delete surface.dataset.timelineHoldsHead;
        if (frame === 8 && motion === "delayed transition")
          surface.animate([{ width: "100px" }, { width: "200px" }], {
            delay: 200,
            duration: 250,
            fill: "forwards",
          });
        if (frame === 11 && motion === "scroll between still frames") surface.scrollTop = 120;
        if (frame < 24) requestAnimationFrame(advance);
        if (frame === 14) surface.dataset.finished = "true";
      };
      requestAnimationFrame(advance);
    }, motion);
    const widths: number[] = [];
    await waitForStillFrames(web.page, {
      selector: "#surface",
      stillFrames: 8,
      phaseStarted: () => {
        const surface = document.querySelector<HTMLElement>("#surface");
        return (
          surface?.dataset.started === "true" && !surface.hasAttribute("data-timeline-holds-head")
        );
      },
      ...(motion === "delayed transition"
        ? {
            sample: async () => {
              widths.push(
                await web.page.$eval("#surface", (node) => node.getBoundingClientRect().width),
              );
            },
          }
        : {}),
    });
    const result = await web.page.$eval("#surface", (node) => ({
      width: node.getBoundingClientRect().width,
      scroll: node.scrollTop,
      finished: (node as HTMLElement).dataset.finished,
      fold: node.getAttribute("data-run-fold"),
      headHold: node.hasAttribute("data-timeline-holds-head"),
    }));
    expect(
      result,
      "ASSERTION: the phase and its motion completed before the geometry witness",
    ).toEqual({
      width: motion === "delayed transition" ? 200 : 100,
      scroll: motion === "scroll between still frames" ? 120 : 0,
      finished: "true",
      fold: null,
      headHold: false,
    });
    if (motion === "delayed transition")
      expect(
        widths.some((width) => width > 100 && width < 200),
        "ASSERTION: the witness samples motion, not only its end",
      ).toBe(true);
  } finally {
    await web.close();
    await NodeFSP.rm(dist, { recursive: true, force: true });
  }
});

it("a still-frame wait stopped before the layout settles names what still moves", async () => {
  const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-still-"));
  await NodeFSP.writeFile(dist + "/index.html", `<!doctype html><div id="surface">slides</div>`);
  const web = await openBrowser(dist, {});
  try {
    await web.page.goto(web.origin);
    await web.page.evaluate(() => {
      document
        .querySelector("#surface")!
        .animate([{ width: "100px" }, { width: "200px" }], { duration: 3_600_000, id: "slide" });
    });
    const stop = new AbortController();
    const waited = waitForStillFrames(web.page, { selector: "#surface", signal: stop.signal }).then(
      () => "settled",
      (error: Error) => error.message,
    );
    // Two frames after the wait's own setup was sent, its trace has sampled the page.
    await web.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    stop.abort();
    expect(await waited).toContain("slide");
  } finally {
    await web.close();
    await NodeFSP.rm(dist, { recursive: true, force: true });
  }
});
