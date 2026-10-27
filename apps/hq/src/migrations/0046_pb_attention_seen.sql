CREATE TABLE hq_attention_seen (
  user_id text NOT NULL,
  project_id text NOT NULL,
  result_id text NOT NULL,
  PRIMARY KEY (user_id, project_id, result_id)
);
