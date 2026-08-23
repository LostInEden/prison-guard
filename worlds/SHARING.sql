-- Shared world storage for the editor (Supabase). Run once in the SQL editor, then set the room code (bottom).
create table public.worlds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  author text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index on public.worlds (name, created_at desc);
create table private_config (key text primary key, value text not null);
insert into private_config values ('room_code', 'CHANGE-ME');
alter table private_config enable row level security;
alter table public.worlds enable row level security;

create or replace function room_ok(code text) returns boolean
language sql security definer as $$
  select exists (select 1 from private_config where key = 'room_code' and value = code);
$$;
create or replace function list_worlds(code text)
returns table (id uuid, name text, author text, created_at timestamptz, versions bigint)
language sql security definer as $$
  select distinct on (w.name) w.id, w.name, w.author, w.created_at, count(*) over (partition by w.name) as versions
  from public.worlds w where room_ok(code) order by w.name, w.created_at desc;
$$;
create or replace function world_versions(code text, world_name text)
returns table (id uuid, author text, created_at timestamptz)
language sql security definer as $$
  select id, author, created_at from public.worlds where room_ok(code) and name = world_name order by created_at desc limit 50;
$$;
create or replace function load_world(code text, world_id uuid) returns jsonb
language sql security definer as $$
  select data from public.worlds where room_ok(code) and id = world_id;
$$;
create or replace function save_world(code text, world_name text, world_author text, world_data jsonb) returns uuid
language plpgsql security definer as $$
declare new_id uuid;
begin
  if not room_ok(code) then raise exception 'bad room code'; end if;
  insert into public.worlds (name, author, data) values (world_name, world_author, world_data) returning id into new_id;
  return new_id;
end $$;

-- set the shared room code:
-- update private_config set value = 'your-code' where key = 'room_code';
