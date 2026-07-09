-- Append-only activity log.
--
-- One row per contest action (create / save / delete) so an account's history
-- outlives the contests themselves. The log is WRITE-ONLY from the routes'
-- point of view: rows are inserted best-effort and never updated or deleted, so
-- the trail is immutable by construction.
--
-- Fields are DENORMALIZED on purpose. user_email and contest_name are copied in
-- at record time rather than joined at read time so an event stays readable
-- after its contest row is deleted (the whole point of a delete event) and
-- without the server ever having to touch Better Auth's user table. seq is a
-- monotonic surrogate key that also gives newest-first ordering a stable
-- tiebreaker when two events share an occurred_at.
--
-- occurred_at is text (ISO 8601 UTC) to mirror the contests table, whose
-- timestamps are ISO strings from the client-side contest model. contest_id and
-- contest_name are nullable because not every future event type targets a
-- contest. detail is optional structured context (jsonb) for the same reason.
--
-- No foreign keys: like contests.sql this migration stays self-contained so it
-- runs against the in-memory Postgres in the integration tests, where neither
-- Better Auth's tables nor the contests table are guaranteed to exist.
create table if not exists events (
  seq          bigserial primary key,
  occurred_at  text not null,
  user_id      text not null,
  user_email   text not null,
  type         text not null,
  contest_id   text,
  contest_name text,
  detail       jsonb
);

create index if not exists events_user_id_idx on events (user_id);
