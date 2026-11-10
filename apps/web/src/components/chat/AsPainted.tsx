/**
 * Where a live card's head stands, read as the page last painted it — before
 * a commit that changes it lays anything out (`getSnapshotBeforeUpdate`), in
 * the commits that ask (`of` changed): the one that ends a run's turn, the
 * one in which a queued message leaves its row.
 *
 * It was read in every frame while a run went on, so that it was fresh
 * whenever a commit asked: a frame's work sixty times a second for hours,
 * with nothing moving, and each one a main-thread frame that ticked every
 * animation of the page too (the owner, 2026-11-10: a run at 299 steps "on
 * like 5 FPS"). Before a commit touches the page, the page still stands as
 * it was painted: read then, the same answer costs one read a commit.
 */
import { Component } from "react";

import { readPainted } from "./wordsLanding";

export class AsPainted extends Component<{
  /** What the commit draws: read before each commit that brings another. */
  readonly of: unknown;
  /** What else a commit may bring with the same `of`, and asks all the same (a card's landing). */
  readonly and?: unknown;
}> {
  override getSnapshotBeforeUpdate(): null {
    readPainted();
    return null;
  }

  // React asks for one beside a snapshot; there is nothing to do after the commit.
  override componentDidUpdate(): void {}

  override render(): null {
    return null;
  }
}
