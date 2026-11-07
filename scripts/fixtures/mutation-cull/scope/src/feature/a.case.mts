// A test file's imports as directImports reads them (`.mts`, so the scripts typecheck skips its alias).
import { describe } from "vite-plus/test";
import { a } from "./a";
import { b } from "~/lib/b.js";
import { gone } from "./missing";
export * from "./d";

describe(String([a, b, gone]), () => {});
