import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";
import { collectionPresentation, formatEnvironmentQueryError } from "./query";

it.each([
  {
    cause: Cause.fail({ outcome: "transient", message: "Socket closed." }),
    expected: "Socket closed.",
  },
  { cause: Cause.fail(new Error("Read refused.")), expected: "Read refused." },
  { cause: Cause.fail({ message: " " }), expected: "The environment request failed." },
])("keeps readable owner failure messages", ({ cause, expected }) => {
  expect(formatEnvironmentQueryError(cause)).toBe(expected);
});

describe("collection read evidence", () => {
  it.each([
    {
      name: "initial failure",
      data: null,
      error: "Read refused.",
      pending: false,
      state: "failed",
      message: "Read refused.",
      retained: false,
      items: [],
    },
    {
      name: "retained failure",
      data: ["kept"],
      error: "Read refused.",
      pending: false,
      state: "failed",
      message: "Read refused.",
      retained: true,
      items: ["kept"],
    },
    {
      name: "initial load",
      data: null,
      error: null,
      pending: true,
      state: "loading",
      message: "Loading...",
      retained: false,
      items: [],
    },
    {
      name: "refresh",
      data: ["kept"],
      error: null,
      pending: true,
      state: "loading",
      message: "Loading...",
      retained: true,
      items: ["kept"],
    },
    {
      name: "unknown",
      data: null,
      error: null,
      pending: false,
      state: "unavailable",
      message: "Unavailable.",
      retained: false,
      items: [],
    },
    {
      name: "owner empty",
      data: [],
      error: null,
      pending: false,
      state: "ready",
      message: null,
      retained: false,
      items: [],
    },
    {
      name: "recovery",
      data: ["new"],
      error: null,
      pending: false,
      state: "ready",
      message: null,
      retained: false,
      items: ["new"],
    },
  ])("preserves $name", ({ data, error, pending, state, message, retained, items }) => {
    expect(
      collectionPresentation({ data, error, isPending: pending }, (value) => value, {
        loading: "Loading...",
        unavailable: "Unavailable.",
      }),
    ).toEqual({ state, message, retained, items });
  });
  it("does not trust an empty payload that reports a diagnostic failure", () => {
    expect(
      collectionPresentation(
        { data: [], error: null, isPending: false },
        (value) => value,
        { loading: "Loading...", unavailable: "Unavailable." },
        "Collector refused.",
      ).state,
    ).toBe("failed");
  });
});

it("an incomplete owner read cannot prove an empty collection", () => {
  const presentation = collectionPresentation(
    {
      data: [] as string[],
      error: null,
      isPending: false,
      read: {
        state: "known",
        value: [] as string[],
        coverage: "partial",
        asOf: { ordinal: 1, atMs: 10 },
        freshness: { kind: "live" },
      },
    },
    (value) => value,
    { loading: "Loading...", unavailable: "Unavailable." },
  );
  expect(presentation).toEqual({
    state: "loading",
    items: [],
    message: "Loading...",
    retained: true,
  });
});
