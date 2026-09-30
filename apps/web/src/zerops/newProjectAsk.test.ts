import { isRedirect } from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { Route } from "../routes/zerops_.new";
import { askNewProject, useNewProjectAsk } from "./newProjectAsk";

afterEach(() => {
  useNewProjectAsk.getState().dismiss();
});

describe("New project, asked from anywhere", () => {
  it("opens one ask, which Cancel or Create lets go", () => {
    expect(useNewProjectAsk.getState().asked).toBeNull();
    askNewProject();
    expect(useNewProjectAsk.getState().asked).not.toBeNull();
    useNewProjectAsk.getState().dismiss();
    expect(useNewProjectAsk.getState().asked).toBeNull();
  });
});

// `/zerops/new` was the New project page: a link or a bookmark to it opens the dialog over the
// projects page, and a preload of it asks for nothing.
describe("/zerops/new", () => {
  const beforeLoad = (preload: boolean): unknown => {
    const run = Route.options.beforeLoad as unknown as (context: { preload: boolean }) => void;
    try {
      run({ preload });
    } catch (thrown) {
      return thrown;
    }
    return undefined;
  };

  it("asks for the dialog and hands the route to the projects page", () => {
    const thrown = beforeLoad(false);
    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string; replace: boolean } }).options).toMatchObject({
      to: "/zerops",
      replace: true,
    });
    expect(useNewProjectAsk.getState().asked).not.toBeNull();
  });

  it("asks for nothing on a preload", () => {
    expect(isRedirect(beforeLoad(true))).toBe(true);
    expect(useNewProjectAsk.getState().asked).toBeNull();
  });
});
