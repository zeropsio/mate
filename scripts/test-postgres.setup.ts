import { acquireTestPostgres } from "./test-postgres.ts";

/** Keep the host server alive between files. Each worker owns its own databases independently. */
export default async function setup() {
  const owner = await acquireTestPostgres();
  return owner.close;
}
