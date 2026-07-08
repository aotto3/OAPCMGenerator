-- Per-account contest storage.
--
-- The server treats `payload` as OPAQUE: it is the exact serializeContest()
-- envelope the client persists locally ({ schemaVersion, contest }), stored and
-- returned verbatim. The server never parses contest internals, generates
-- documents, or accepts device-only/credential fields.
--
-- `name` and `updated_at` are thin metadata supplied by the client so the
-- dashboard can list contests without the server reading any payload. They are
-- text (ISO 8601 for updated_at) to mirror the contest model, which uses ISO
-- strings for timestamps.
--
-- owner_id holds the Better Auth user id. No foreign key is declared: this
-- migration stays self-contained (it runs against an in-memory Postgres in the
-- integration tests, where Better Auth's tables do not exist), and ownership is
-- enforced in every query instead. Single-owner in v1 — shared access can be
-- added later as a separate contest_members table without altering this one.
create table if not exists contests (
  id         text primary key,
  owner_id   text not null,
  name       text not null,
  updated_at text not null,
  payload    text not null,
  created_at text not null
);

create index if not exists contests_owner_id_idx on contests (owner_id);
