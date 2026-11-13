-- Custom email templates (PRD #320).
--
-- One row per template, owned by one account. Templates are account-level, not
-- part of any contest, so the CM sees them in every contest. The shared columns
-- are for the opt-in gallery (a later slice); a template is private until its
-- author shares it, and author_name is a snapshot of the CM name the app sends
-- when sharing.
--
-- Like the other migrations: idempotent, self-contained, no foreign keys, and
-- ownership enforced in every query. Name uniqueness (trimmed, case-insensitive)
-- is checked by the store before each write.
create table if not exists email_templates (
  id          text primary key,
  owner_id    text not null,
  name        text not null,
  subject     text not null,
  body        text not null,
  created_at  text not null,
  updated_at  text not null,
  shared      boolean not null default false,
  shared_at   text,
  author_name text
);

create index if not exists email_templates_owner_idx on email_templates (owner_id);
