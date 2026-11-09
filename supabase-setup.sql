-- Hanzel FitTrack Supabase setup
-- Run the entire script in Supabase Dashboard > SQL Editor.
-- Stores the existing tracker state as JSONB, one private row per user.
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text default 'Hanzel', age integer default 23, sex text default 'male',
 height_cm numeric(5,1) default 175.3, current_weight_kg numeric(5,1) default 95,
 goal_weight_kg numeric(5,1) default 85, activity_multiplier numeric(4,3) default 1.55,
 daily_calories integer default 2300, protein_target_g integer default 180,
 carbs_target_g integer default 235, fat_target_g integer default 71,
 created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists tracker_data jsonb not null default '{}'::jsonb;
alter table public.profiles enable row level security;
drop policy if exists "Users manage their own profile" on public.profiles;
create policy "Users manage their own profile" on public.profiles for all to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));
grant select, insert, update on public.profiles to authenticated;
create or replace function public.handle_new_fittrack_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.profiles (id) values (new.id) on conflict (id) do nothing; return new; end;
$$;
drop trigger if exists on_fittrack_user_created on auth.users;
create trigger on_fittrack_user_created after insert on auth.users for each row execute procedure public.handle_new_fittrack_user();