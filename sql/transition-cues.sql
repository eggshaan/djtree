-- Cue sheet on a transition: where it mixes out, where it comes in, how many
-- bars the two run together. Run once against the Supabase project (SQL editor
-- or `supabase db execute`); the local SQLite build migrates itself on start.
--
-- Additive and idempotent. Existing links keep their rows and read as "not
-- recorded" in the panel — the columns are nullable on purpose, because only
-- links made after this exists were ever asked for the numbers.

alter table public.transitions add column if not exists from_cue integer;
alter table public.transitions add column if not exists to_cue   integer;
alter table public.transitions add column if not exists bars     integer;

-- Same bounds the local server validates against, enforced by the database
-- because in cloud mode the browser is the only thing in front of it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transitions_cues_in_range'
  ) then
    alter table public.transitions
      add constraint transitions_cues_in_range check (
        (from_cue is null or (from_cue between 0 and 86400))
        and (to_cue is null or (to_cue between 0 and 86400))
        and (bars is null or (bars between 1 and 512))
      );
  end if;
end $$;

-- Undo restores deleted rows by listing columns explicitly, so it has to learn
-- the new three or an undone delete would come back without its cue sheet.
-- Body is unchanged apart from the transitions insert.
create or replace function public.restore_rows(
  p_tracks jsonb default '[]'::jsonb,
  p_transitions jsonb default '[]'::jsonb,
  p_setlists jsonb default '[]'::jsonb
)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  rec jsonb;
begin
  -- Tracks first so the transitions' foreign keys resolve.
  insert into public.tracks (id, title, artist, bpm, music_key, energy, genre,
                             notes, favorite, x, y, created_at)
  select (r->>'id')::bigint,
         r->>'title',
         coalesce(r->>'artist', ''),
         (r->>'bpm')::double precision,
         nullif(r->>'music_key', ''),
         nullif(r->>'energy', '')::smallint,
         coalesce(r->>'genre', ''),
         coalesce(r->>'notes', ''),
         coalesce(nullif(r->>'favorite', '')::smallint, 0),
         coalesce(nullif(r->>'x', '')::double precision, 0),
         coalesce(nullif(r->>'y', '')::double precision, 0),
         coalesce(nullif(r->>'created_at', '')::timestamptz, now())
    from jsonb_array_elements(p_tracks) as r
  on conflict (id) do nothing;

  insert into public.transitions (id, from_id, to_id, label, rating, notes,
                                  from_cue, to_cue, bars, created_at)
  select (r->>'id')::bigint,
         (r->>'from_id')::bigint,
         (r->>'to_id')::bigint,
         coalesce(r->>'label', ''),
         nullif(r->>'rating', '')::smallint,
         coalesce(r->>'notes', ''),
         nullif(r->>'from_cue', '')::integer,
         nullif(r->>'to_cue', '')::integer,
         nullif(r->>'bars', '')::integer,
         coalesce(nullif(r->>'created_at', '')::timestamptz, now())
    from jsonb_array_elements(p_transitions) as r
  on conflict (id) do nothing;

  for rec in select * from jsonb_array_elements(p_setlists)
  loop
    insert into public.setlists (id, name, notes, created_at)
    values (
      (rec->>'id')::bigint,
      rec->>'name',
      coalesce(rec->>'notes', ''),
      coalesce(nullif(rec->>'created_at', '')::timestamptz, now())
    )
    on conflict (id) do nothing;

    -- Items are positional, so rewrite rather than merge.
    delete from public.setlist_items where setlist_id = (rec->>'id')::bigint;

    insert into public.setlist_items (setlist_id, track_id, "position")
    select (rec->>'id')::bigint, t.track_id, t.ord - 1
      from unnest(
             (select array_agg((v)::text::bigint)
                from jsonb_array_elements(coalesce(rec->'track_ids', '[]'::jsonb)) v)
           ) with ordinality as t(track_id, ord);

    update public.setlist_items si
       set x = (p->>'x')::double precision,
           y = (p->>'y')::double precision
      from jsonb_array_elements(coalesce(rec->'positions', '[]'::jsonb)) p
     where si.setlist_id = (rec->>'id')::bigint
       and si.track_id = (p->>'track_id')::bigint;
  end loop;
end;
$function$;
