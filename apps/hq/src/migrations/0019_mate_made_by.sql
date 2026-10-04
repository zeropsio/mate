-- Who made a Mate: the person whose session set its record up, whose sign-in it waits for until
-- somebody signs its agent in. Never cleared. A Mate recorded before this names nobody.
ALTER TABLE hq_mate ADD COLUMN made_by text;
