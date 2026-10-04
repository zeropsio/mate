import Migration0057 from "./057_ProjectionThreadActivityBudgetColumns.ts";

/**
 * Upstream's 57 again, for a database whose 57 was the crew operations table (dev builds before
 * upstream took that id): the migrator skipped upstream's 57 there. It only adds what is missing,
 * so a database that ran it already is unchanged.
 */
export default Migration0057;
