-- Game history and replay support.
-- Run once after schema.sql in Supabase Dashboard -> SQL Editor.

create table if not exists public.game_records (
  id uuid primary key default gen_random_uuid(),
  client_game_id text,
  room_id uuid unique references public.rooms(id) on delete set null,
  game_type text not null check (game_type in ('ai', 'local', 'online')),
  owner_id uuid references public.profiles(id) on delete cascade,
  owner_color smallint check (owner_color in (1, 2)),
  black_user_id uuid references public.profiles(id) on delete set null,
  white_user_id uuid references public.profiles(id) on delete set null,
  black_name text not null,
  white_name text not null,
  difficulty text check (difficulty in ('easy', 'normal', 'hard')),
  winner_color smallint check (winner_color in (1, 2)),
  finish_reason text not null check (finish_reason in ('five', 'surrender', 'draw')),
  created_at timestamptz not null default now(),
  unique (owner_id, client_game_id),
  constraint game_records_owner_check check (
    (game_type = 'online' and owner_id is null and owner_color is null and black_user_id is not null and white_user_id is not null)
    or
    (game_type in ('ai', 'local') and owner_id is not null and owner_color is not null)
  )
);

create table if not exists public.game_record_moves (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.game_records(id) on delete cascade,
  move_no integer not null check (move_no between 1 and 225),
  x smallint not null check (x between 0 and 14),
  y smallint not null check (y between 0 and 14),
  player smallint not null check (player in (1, 2)),
  unique (game_id, move_no),
  unique (game_id, x, y)
);

create index if not exists game_records_owner_idx
  on public.game_records(owner_id, created_at desc);
create index if not exists game_records_black_idx
  on public.game_records(black_user_id, created_at desc);
create index if not exists game_records_white_idx
  on public.game_records(white_user_id, created_at desc);
create index if not exists game_record_moves_game_idx
  on public.game_record_moves(game_id, move_no);

alter table public.game_records enable row level security;
alter table public.game_record_moves enable row level security;

revoke all on public.game_records, public.game_record_moves from anon;
revoke insert, update, delete on public.game_records, public.game_record_moves from authenticated;
grant select on public.game_records, public.game_record_moves to authenticated;

drop policy if exists game_records_read_participants on public.game_records;
create policy game_records_read_participants
on public.game_records for select to authenticated
using (
  auth.uid() = owner_id
  or auth.uid() = black_user_id
  or auth.uid() = white_user_id
);

drop policy if exists game_record_moves_read_participants on public.game_record_moves;
create policy game_record_moves_read_participants
on public.game_record_moves for select to authenticated
using (
  exists (
    select 1
    from public.game_records record
    where record.id = game_record_moves.game_id
      and (
        auth.uid() = record.owner_id
        or auth.uid() = record.black_user_id
        or auth.uid() = record.white_user_id
      )
  )
);

create or replace function public.archive_finished_online_room()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  archived_game_id uuid;
  black_username text;
  white_username text;
begin
  if new.status <> 'finished' or old.status = 'finished' then
    return new;
  end if;

  select username::text into black_username
  from public.profiles where id = new.black_user_id;
  select username::text into white_username
  from public.profiles where id = new.white_user_id;

  insert into public.game_records (
    room_id,
    game_type,
    black_user_id,
    white_user_id,
    black_name,
    white_name,
    winner_color,
    finish_reason
  ) values (
    new.id,
    'online',
    new.black_user_id,
    new.white_user_id,
    black_username,
    white_username,
    case
      when new.winner_id = new.black_user_id then 1
      when new.winner_id = new.white_user_id then 2
      else null
    end,
    new.finish_reason
  )
  on conflict (room_id) do update set room_id = excluded.room_id
  returning id into archived_game_id;

  insert into public.game_record_moves (game_id, move_no, x, y, player)
  select archived_game_id, move_no, x, y, player
  from public.moves
  where room_id = new.id
  order by move_no
  on conflict (game_id, move_no) do nothing;

  return new;
end;
$$;

drop trigger if exists on_online_room_finished on public.rooms;
create trigger on_online_room_finished
  after update of status on public.rooms
  for each row execute procedure public.archive_finished_online_room();

create or replace function public.save_local_game(
  p_client_game_id text,
  p_game_type text,
  p_difficulty text,
  p_player_color smallint,
  p_winner_color smallint,
  p_finish_reason text,
  p_moves jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  saved_game_id uuid;
  username text;
  black_display_name text;
  white_display_name text;
begin
  if uid is null then
    raise exception 'You must be signed in';
  end if;
  if p_client_game_id is null or char_length(p_client_game_id) not between 1 and 100 then
    raise exception 'Invalid game identifier';
  end if;
  if p_game_type not in ('ai', 'local') then
    raise exception 'Invalid local game type';
  end if;
  if p_player_color not in (1, 2) then
    raise exception 'Invalid player color';
  end if;
  if p_winner_color is not null and p_winner_color not in (1, 2) then
    raise exception 'Invalid winner color';
  end if;
  if p_finish_reason not in ('five', 'surrender', 'draw') then
    raise exception 'Invalid finish reason';
  end if;
  if p_game_type = 'ai' and p_difficulty not in ('easy', 'normal', 'hard') then
    raise exception 'Invalid AI difficulty';
  end if;
  if p_game_type = 'local' then
    p_difficulty := null;
  end if;
  if p_moves is null or jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) > 225 then
    raise exception 'Invalid move list';
  end if;

  select profiles.username::text into username
  from public.profiles where id = uid;

  black_display_name := case
    when p_player_color = 1 then username
    when p_game_type = 'ai' then 'PentaZen AI'
    else '本地玩家'
  end;
  white_display_name := case
    when p_player_color = 2 then username
    when p_game_type = 'ai' then 'PentaZen AI'
    else '本地玩家'
  end;

  insert into public.game_records (
    client_game_id,
    game_type,
    owner_id,
    owner_color,
    black_name,
    white_name,
    difficulty,
    winner_color,
    finish_reason
  ) values (
    p_client_game_id,
    p_game_type,
    uid,
    p_player_color,
    black_display_name,
    white_display_name,
    p_difficulty,
    p_winner_color,
    p_finish_reason
  )
  on conflict (owner_id, client_game_id)
  do update set client_game_id = excluded.client_game_id
  returning id into saved_game_id;

  insert into public.game_record_moves (game_id, move_no, x, y, player)
  select
    saved_game_id,
    move_number::integer,
    (move ->> 'x')::smallint,
    (move ->> 'y')::smallint,
    (move ->> 'player')::smallint
  from jsonb_array_elements(p_moves) with ordinality as item(move, move_number)
  where (move ->> 'x')::integer between 0 and 14
    and (move ->> 'y')::integer between 0 and 14
    and (move ->> 'player')::integer in (1, 2)
  on conflict (game_id, move_no) do nothing;

  if (
    select count(*) from public.game_record_moves where game_id = saved_game_id
  ) <> jsonb_array_length(p_moves) then
    raise exception 'One or more moves are invalid';
  end if;

  return saved_game_id;
end;
$$;

create or replace function public.delete_local_game(p_client_game_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.game_records
  where owner_id = auth.uid()
    and game_records.client_game_id = p_client_game_id
    and game_type in ('ai', 'local');
$$;

revoke all on function public.save_local_game(text, text, text, smallint, smallint, text, jsonb)
  from public, anon;
revoke all on function public.delete_local_game(text) from public, anon;
revoke all on function public.archive_finished_online_room() from public, anon, authenticated;

grant execute on function public.save_local_game(text, text, text, smallint, smallint, text, jsonb)
  to authenticated;
grant execute on function public.delete_local_game(text) to authenticated;
