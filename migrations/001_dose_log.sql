create table if not exists viewers (
  sub text primary key,
  pills_on_hand double precision,
  usual_morning double precision not null default 0.5,
  usual_afternoon double precision not null default 0.5,
  usual_night double precision not null default 0.5,
  created_at timestamptz not null default now()
);

create table if not exists dose_days (
  sub text not null references viewers (sub),
  day text not null,
  morning text not null default '',
  afternoon text not null default '',
  night text not null default '',
  morning_extra double precision not null default 0,
  afternoon_extra double precision not null default 0,
  night_extra double precision not null default 0,
  primary key (sub, day)
);

create table if not exists dose_undo (
  sub text primary key references viewers (sub),
  payload text not null,
  created_at timestamptz not null default now()
);

create table if not exists sheet_owner (
  id integer primary key check (id = 1),
  owner_sub text not null,
  claimed_at timestamptz not null default now()
);
