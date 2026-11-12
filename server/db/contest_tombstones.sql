-- Durable contest delete tombstones (RFC #276, slice #280).
--
-- A row records that `owner_id` deleted contest `id` at `deleted_at` (ISO 8601
-- text, normalized by the server to toISOString form). Deletes and edits from
-- different devices converge by "newer action wins, ties go to the delete":
-- a write stamped at or before `deleted_at` is refused with 410, a newer write
-- clears the tombstone. Kept indefinitely (owner decision on #262); no pruning.
--
-- Owner-scoped like `contests`, with no foreign key for the same reason (the
-- migration stays self-contained for the in-memory Postgres in tests). The key
-- is (owner_id, id), so one owner's tombstone never touches another's data.
create table if not exists contest_tombstones (
  owner_id   text not null,
  id         text not null,
  deleted_at text not null,
  primary key (owner_id, id)
);
