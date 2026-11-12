-- Judge questionnaire (PRD #252).
--
-- questionnaire_links: one standing, unguessable link token per account. The
-- public questionnaire page is addressed by this token; resetting it replaces
-- the row's token, which kills the old link.
--
-- judge_rosters: the one piece of contest-derived data the server can READ. The
-- app publishes it on sync: each upcoming contest's id/title/level/date/host/CM
-- email and each judge's normalized email/name/contest ids. Nothing else about a
-- judge is ever sent here. Stored as JSON text, validated on write, replaced
-- whole on every publish.
--
-- Like the other migrations: idempotent, self-contained, no foreign keys, and
-- ownership enforced in every query.
create table if not exists questionnaire_links (
  owner_id   text primary key,
  token      text not null unique,
  created_at text not null
);

create table if not exists judge_rosters (
  owner_id   text primary key,
  roster     text not null,
  updated_at text not null
);

-- judge_submissions: each judge's current questionnaire answers, one row per
-- (account, judge email); a resubmit replaces the row. The app pulls these and
-- writes them into its contests; the server never touches contest payloads.
create table if not exists judge_submissions (
  owner_id     text not null,
  email        text not null,
  submitted_at text not null,
  answers      text not null,
  primary key (owner_id, email)
);
