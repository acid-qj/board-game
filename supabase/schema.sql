-- Board Game: username accounts and secure online Gomoku rooms.
-- Run this file once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username extensions.citext not null unique,
  created_at timestamptz not null default now(),
  constraint profiles_username_length check (char_length(username::text) between 2 and 20)
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references public.profiles(id) on delete cascade,
  guest_id uuid references public.profiles(id) on delete set null,
  black_user_id uuid not null references public.profiles(id) on delete cascade,
  white_user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'waiting'
    check (status in ('waiting', 'playing', 'finished')),
  current_player smallint not null default 1
    check (current_player in (1, 2)),
  winner_id uuid references public.profiles(id) on delete set null,
  finish_reason text check (finish_reason in ('five', 'surrender', 'draw')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.moves (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  move_no integer not null check (move_no between 1 and 225),
  x smallint not null check (x between 0 and 14),
  y smallint not null check (y between 0 and 14),
  player smallint not null check (player in (1, 2)),
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (room_id, move_no),
  unique (room_id, x, y)
);

create index if not exists rooms_host_id_idx on public.rooms(host_id);
create index if not exists rooms_guest_id_idx on public.rooms(guest_id);
create index if not exists moves_room_id_idx on public.moves(room_id, move_no);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.moves enable row level security;

revoke all on public.profiles, public.rooms, public.moves from anon;
revoke insert, update, delete on public.profiles, public.rooms, public.moves from authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles, public.rooms, public.moves to authenticated;

drop policy if exists profiles_read_authenticated on public.profiles;
create policy profiles_read_authenticated
on public.profiles for select to authenticated
using (true);

drop policy if exists rooms_read_members on public.rooms;
create policy rooms_read_members
on public.rooms for select to authenticated
using (auth.uid() = host_id or auth.uid() = guest_id);

drop policy if exists moves_read_room_members on public.moves;
create policy moves_read_room_members
on public.moves for select to authenticated
using (
  exists (
    select 1
    from public.rooms r
    where r.id = moves.room_id
      and (r.host_id = auth.uid() or r.guest_id = auth.uid())
  )
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
begin
  requested_username := trim(new.raw_user_meta_data ->> 'username');

  if requested_username is null
     or char_length(requested_username) < 2
     or char_length(requested_username) > 20 then
    raise exception 'Username must contain 2 to 20 characters';
  end if;

  insert into public.profiles (id, username)
  values (new.id, requested_username);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.create_room()
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_code text;
  result public.rooms;
begin
  if uid is null then
    raise exception 'You must be signed in';
  end if;

  if not exists (select 1 from public.profiles where id = uid) then
    raise exception 'Profile not found';
  end if;

  loop
    new_code := upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
    begin
      insert into public.rooms (code, host_id, black_user_id)
      values (new_code, uid, uid)
      returning * into result;
      exit;
    exception when unique_violation then
      -- A rare room-code collision: generate another code.
    end;
  end loop;

  return result;
end;
$$;

create or replace function public.join_room(room_code text)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  result public.rooms;
begin
  if uid is null then
    raise exception 'You must be signed in';
  end if;

  select * into result
  from public.rooms
  where code = upper(trim(room_code))
  for update;

  if not found then
    raise exception 'Room not found';
  end if;

  if result.host_id = uid or result.guest_id = uid then
    return result;
  end if;

  if result.status <> 'waiting' or result.guest_id is not null then
    raise exception 'Room is full or has already started';
  end if;

  update public.rooms
  set guest_id = uid,
      white_user_id = uid,
      status = 'playing',
      updated_at = now()
  where id = result.id
  returning * into result;

  return result;
end;
$$;

create or replace function public.room_has_five(
  target_room uuid,
  target_player smallint,
  origin_x smallint,
  origin_y smallint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  directions_x integer[] := array[1, 0, 1, 1];
  directions_y integer[] := array[0, 1, 1, -1];
  direction_index integer;
  step_index integer;
  consecutive integer;
begin
  for direction_index in 1..4 loop
    consecutive := 1;

    for step_index in 1..4 loop
      if exists (
        select 1 from public.moves
        where room_id = target_room
          and player = target_player
          and x = origin_x + directions_x[direction_index] * step_index
          and y = origin_y + directions_y[direction_index] * step_index
      ) then
        consecutive := consecutive + 1;
      else
        exit;
      end if;
    end loop;

    for step_index in 1..4 loop
      if exists (
        select 1 from public.moves
        where room_id = target_room
          and player = target_player
          and x = origin_x - directions_x[direction_index] * step_index
          and y = origin_y - directions_y[direction_index] * step_index
      ) then
        consecutive := consecutive + 1;
      else
        exit;
      end if;
    end loop;

    if consecutive >= 5 then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

create or replace function public.play_move(
  room_code text,
  move_x smallint,
  move_y smallint
)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  room_state public.rooms;
  next_move_no integer;
  expected_user uuid;
begin
  if uid is null then
    raise exception 'You must be signed in';
  end if;

  if move_x not between 0 and 14 or move_y not between 0 and 14 then
    raise exception 'Move is outside the board';
  end if;

  select * into room_state
  from public.rooms
  where code = upper(trim(room_code))
  for update;

  if not found then
    raise exception 'Room not found';
  end if;

  if room_state.status <> 'playing' then
    raise exception 'The game is not active';
  end if;

  expected_user := case room_state.current_player
    when 1 then room_state.black_user_id
    else room_state.white_user_id
  end;

  if expected_user is distinct from uid then
    raise exception 'It is not your turn';
  end if;

  if exists (
    select 1 from public.moves
    where room_id = room_state.id and x = move_x and y = move_y
  ) then
    raise exception 'That intersection is occupied';
  end if;

  select count(*)::integer + 1 into next_move_no
  from public.moves where room_id = room_state.id;

  insert into public.moves (room_id, move_no, x, y, player, user_id)
  values (
    room_state.id,
    next_move_no,
    move_x,
    move_y,
    room_state.current_player,
    uid
  );

  if public.room_has_five(
    room_state.id,
    room_state.current_player,
    move_x,
    move_y
  ) then
    update public.rooms
    set status = 'finished',
        winner_id = uid,
        finish_reason = 'five',
        updated_at = now()
    where id = room_state.id
    returning * into room_state;
  elsif next_move_no = 225 then
    update public.rooms
    set status = 'finished',
        winner_id = null,
        finish_reason = 'draw',
        updated_at = now()
    where id = room_state.id
    returning * into room_state;
  else
    update public.rooms
    set current_player = case current_player when 1 then 2 else 1 end,
        updated_at = now()
    where id = room_state.id
    returning * into room_state;
  end if;

  return room_state;
end;
$$;

create or replace function public.surrender_room(room_code text)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  room_state public.rooms;
  winning_user uuid;
begin
  if uid is null then
    raise exception 'You must be signed in';
  end if;

  select * into room_state
  from public.rooms
  where code = upper(trim(room_code))
  for update;

  if not found then
    raise exception 'Room not found';
  end if;

  if room_state.status <> 'playing' then
    raise exception 'The game is not active';
  end if;

  if uid = room_state.black_user_id then
    winning_user := room_state.white_user_id;
  elsif uid = room_state.white_user_id then
    winning_user := room_state.black_user_id;
  else
    raise exception 'You are not a player in this room';
  end if;

  update public.rooms
  set status = 'finished',
      winner_id = winning_user,
      finish_reason = 'surrender',
      updated_at = now()
  where id = room_state.id
  returning * into room_state;

  return room_state;
end;
$$;

revoke all on function public.create_room() from public, anon;
revoke all on function public.join_room(text) from public, anon;
revoke all on function public.play_move(text, smallint, smallint) from public, anon;
revoke all on function public.surrender_room(text) from public, anon;
revoke all on function public.room_has_five(uuid, smallint, smallint, smallint) from public, anon;

grant execute on function public.create_room() to authenticated;
grant execute on function public.join_room(text) to authenticated;
grant execute on function public.play_move(text, smallint, smallint) to authenticated;
grant execute on function public.surrender_room(text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'moves'
  ) then
    alter publication supabase_realtime add table public.moves;
  end if;
end;
$$;
