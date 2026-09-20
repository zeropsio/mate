import { describe, expect, it } from "vite-plus/test";

import { useAddMateIntent } from "./addMateIntent";

describe("useAddMateIntent", () => {
  it("has nothing to answer before anything is asked", () => {
    useAddMateIntent.setState({ groupId: null });
    expect(useAddMateIntent.getState().take()).toBeNull();
  });

  it("hands the group over once, and only once", () => {
    useAddMateIntent.setState({ groupId: null });
    useAddMateIntent.getState().request("group-1");
    expect(useAddMateIntent.getState().take()).toBe("group-1");
    // A second visit to the projects screen must not reopen the dialog.
    expect(useAddMateIntent.getState().take()).toBeNull();
  });

  it("keeps the latest ask when one is made before the last is taken", () => {
    useAddMateIntent.setState({ groupId: null });
    useAddMateIntent.getState().request("group-1");
    useAddMateIntent.getState().request("group-2");
    expect(useAddMateIntent.getState().take()).toBe("group-2");
  });
});
