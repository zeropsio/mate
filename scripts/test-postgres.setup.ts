import { acquireTestPostgres, ensureRoom, postgresHome } from "./test-postgres.ts";

/**
 * Keep the host server alive between files. Each worker owns its own databases independently. A
 * disk without room stops the run here, before any case, even when another run's server serves.
 */
export default async function setup() {
  ensureRoom(postgresHome);
  const owner = await acquireTestPostgres();
  return owner.close;
}
