# Test PostgreSQL ownership

HQ integration tests and hosted scenarios share one PostgreSQL server per OS user on the host.
`scripts/test-postgres.ts` acquires a connection-owned lease; the Vitest global setup holds one
for the run, and each `tempPostgresLayer` holds another for its file. Every `createDatabase` clones
`template0` into a distinct database. Releasing a file drops all of its databases, including any
remaining connections. A killed owner closes its socket and receives the same cleanup.

The supervisor and cluster live under `/tmp/mate-test-pg-<uid>` across worktrees. Kernel locks
serialize startup/shutdown and the PostgreSQL owner's lifetime; they never serialize test runs.
The server stops when its final owner disappears, without an idle timer. A pipe guard stops
PostgreSQL even if the supervisor is killed. On the next startup, databases belonging to a previous
supervisor are dropped before any new owner receives a database. An interrupted acquisition keeps
no owner alive. The initialized cluster is retained for reuse; test data is disposable.

Local prerequisites are `flock` and PostgreSQL's `initdb`, `pg_ctl` and `psql`. Binary discovery uses
`MATE_PG_BIN`, `pg_config --bindir`, Debian/Ubuntu installations, then Homebrew. CI uses the same
model on its job host. Failures propagate to the test runner; `supervisor.log` and `postgres.log`
in the cluster directory retain process diagnostics. A command deadline can fail infrastructure,
but elapsed time never determines owner liveness or successful cleanup.

Run-level leases cover the test run even when files are serial. Existing worker limits still
bound browser and suite load. Concurrent runs share the same server and can overlap; database
names and cleanup ownership are distinct. The final owner's cleanup reply waits for server stop.

PostgreSQL snapshot transaction IDs are cluster-wide. Backup reuse tests hold a repeatable-read
snapshot to exercise an unchanged position while other databases are active. Checks for local
leadership writes inspect the owned database's row version.

Fault injection and activity assertions filter sessions by their owned database. Administrative
connections target that database explicitly before terminating any backend.
