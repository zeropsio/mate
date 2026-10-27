-- Whether the person who recorded a Mate's birth intent asks for its stand-up: the attach that
-- closes the intent records them as its asker in the same write as the Mate's record, so the
-- record and its ask never part (audit B3).
ALTER TABLE hq_birth_intent ADD COLUMN standup boolean NOT NULL DEFAULT false;
