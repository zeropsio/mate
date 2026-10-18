-- What a task cost and how long it worked (`MateTaskReport.spentUsd`/`workedMs`), as its Mate last
-- reported; when its Mate took it (`started_at`) and when it ended (`ended_at`), kept by the
-- trigger below whichever path moves it — its Mate's word or HQ's own (overdue, gone, stopped).
-- An application's board lists them (`appTasks.ts`); the month's spend is their sum.
ALTER TABLE hq_task
  ADD COLUMN spent_usd double precision CHECK (spent_usd >= 0),
  ADD COLUMN worked_ms bigint CHECK (worked_ms >= 0),
  ADD COLUMN started_at timestamptz,
  ADD COLUMN ended_at timestamptz;
-- Tasks from before: taken when handed out to the Mate that worked them, ended when last moved.
UPDATE hq_task SET started_at = assigned_at WHERE conversation_id IS NOT NULL;
UPDATE hq_task SET ended_at = updated_at WHERE state IN ('done', 'failed', 'stopped', 'dropped');

-- Taken once (its first word that it works): `started_at`, kept. Ended: `ended_at`, kept while it
-- stays ended (done, then stopped as its change closed, keeps when it was done); back at work after
-- it ended (a review woke it), it is no longer ended.
CREATE OR REPLACE FUNCTION hq_task_times() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.state IN ('working', 'waiting') THEN
    NEW.started_at := COALESCE(NEW.started_at, now());
    NEW.ended_at := NULL;
  ELSIF NEW.state IN ('done', 'failed', 'stopped', 'dropped') THEN
    IF TG_OP = 'INSERT' OR OLD.state NOT IN ('done', 'failed', 'stopped', 'dropped') THEN
      NEW.ended_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hq_task_times BEFORE INSERT OR UPDATE OF state ON hq_task
  FOR EACH ROW EXECUTE FUNCTION hq_task_times();

-- An application's board: its latest ended tasks, newest first.
CREATE INDEX hq_task_ended ON hq_task (app_id, ended_at DESC) WHERE ended_at IS NOT NULL;
-- This month's spend: the tasks taken since the month began.
CREATE INDEX hq_task_started ON hq_task (started_at) WHERE spent_usd IS NOT NULL;

-- What the organization's automated Mates may spend in a calendar month (UTC), all tasks together;
-- none: no budget (`HqTaskLimitsView.monthlyBudgetUsd`).
ALTER TABLE hq_task_limits ADD COLUMN monthly_budget_usd double precision
  CHECK (monthly_budget_usd > 0);
