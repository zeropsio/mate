import { expect, it } from "@effect/vitest";
import { resolveZeropsEnvironment } from "../zerops/ZeropsEnvironment.ts";
import { isAllowedWebSocketOrigin } from "./origin.ts";

const zerops = {
  ...resolveZeropsEnvironment({ projectId: "project", apiHost: undefined })!,
  allowedOrigins: ["http://localhost:5173", "https://preview.example.test"],
};

it.each([
  {
    title: "admits the hosted client's exact origin",
    origin: "https://mate.zerops.io",
    allowed: true,
  },
  {
    title: "admits an exact configured development origin",
    origin: "http://localhost:5173",
    allowed: true,
  },
  {
    title: "admits every configured origin",
    origin: "https://preview.example.test",
    allowed: true,
  },
  { title: "refuses a missing Origin before reading a ticket", origin: undefined, allowed: false },
  { title: "refuses an opaque Origin before reading a ticket", origin: "null", allowed: false },
  {
    title: "refuses a foreign Origin before reading a ticket",
    origin: "https://foreign.example.test",
    allowed: false,
  },
  {
    title: "refuses a hosted-origin suffix lookalike",
    origin: "https://mate.zerops.io.evil.test",
    allowed: false,
  },
  {
    title: "refuses an unconfigured development port",
    origin: "http://localhost:5174",
    allowed: false,
  },
  {
    title: "refuses an unconfigured hosted-client scheme",
    origin: "http://mate.zerops.io",
    allowed: false,
  },
  {
    title: "requires an exact Origin rather than a URL path",
    origin: "https://mate.zerops.io/",
    allowed: false,
  },
])("$title", ({ origin, allowed }) => {
  expect(isAllowedWebSocketOrigin({ zerops }, origin)).toBe(allowed);
});

it.each([undefined, "null", "https://foreign.example.test"])(
  "leaves non-Zerops origin policy unchanged for %s",
  (origin) => expect(isAllowedWebSocketOrigin({ zerops: undefined }, origin)).toBe(true),
);
