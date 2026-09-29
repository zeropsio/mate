import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  deletingMates,
  markMateDeleting,
  mateDeleting,
  settleDeletingMates,
  subscribeDeletingMates,
} from "./deletingMates";

afterEach(() => {
  closeAccountLifetime();
});

describe("the Mates this tab is deleting", () => {
  it("holds a Mate from the platform's yes until the listing lets it go", () => {
    openAccountLifetime("user-ada");
    markMateDeleting("acme-docs-quinn");
    markMateDeleting("acme-docs-fen");
    expect([...deletingMates()]).toEqual(["acme-docs-quinn", "acme-docs-fen"]);
    // The listing still holds Quinn, gone to DELETING; Fen is no longer listed.
    settleDeletingMates(new Set(["acme-docs-quinn", "acme-docs-ada"]));
    expect([...deletingMates()]).toEqual(["acme-docs-quinn"]);
    settleDeletingMates(new Set(["acme-docs-ada"]));
    expect(deletingMates().size).toBe(0);
  });

  it("tells whoever listens when it changes, and only then", () => {
    openAccountLifetime("user-ada");
    const heard = vi.fn();
    const stop = subscribeDeletingMates(heard);
    markMateDeleting("acme-docs-quinn");
    markMateDeleting("acme-docs-quinn");
    settleDeletingMates(new Set(["acme-docs-quinn"]));
    expect(heard).toHaveBeenCalledTimes(1);
    settleDeletingMates(new Set());
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });

  it("forgets them all when the account closes", () => {
    openAccountLifetime("user-ada");
    markMateDeleting("acme-docs-quinn");
    closeAccountLifetime();
    expect(deletingMates().size).toBe(0);
  });
});

describe("mateDeleting — a Mate on its way off Zerops", () => {
  const quinn = (status: string) => ({ id: "acme-docs-quinn", status });

  it.each([
    { case: "this tab asked, the platform not there yet", status: "ACTIVE", asked: true, is: true },
    { case: "the platform deleting it", status: "DELETING", asked: false, is: true },
    { case: "the platform done with it", status: "DELETED", asked: false, is: true },
    { case: "a Mate at work", status: "ACTIVE", asked: false, is: false },
    { case: "a stopped Mate", status: "STOPPED", asked: false, is: false },
  ])("$case → $is", ({ status, asked, is }) => {
    expect(mateDeleting(quinn(status), new Set(asked ? ["acme-docs-quinn"] : []))).toBe(is);
  });
});
