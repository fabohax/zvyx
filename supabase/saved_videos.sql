create extension if not exists pgcrypto;

create table if not exists public.saved_videos (
  id uuid primary key default gen_random_uuid(),
  source_url text not null,
  canonical_url text not null,
  title text not null,
  thumbnail_url text,
  author_name text,
  provider text,
  duration_label text,
  requested_format text not null check (requested_format in ('mp4', 'mp3', 'best')),
  requested_quality text not null check (requested_quality in ('best', '1080p', '720p', '480p')),
  file_name text,
  storage_path text,
  video_url text,
  file_size_bytes bigint,
  view_count bigint,
  publish_date timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);
alter table public.saved_videos add column if not exists view_count bigint;
alter table public.saved_videos add column if not exists publish_date timestamptz;

alter table public.saved_videos add column if not exists file_name text;
alter table public.saved_videos add column if not exists storage_path text;
alter table public.saved_videos add column if not exists video_url text;
alter table public.saved_videos add column if not exists file_size_bytes bigint;

do $$
begin
  alter table public.saved_videos drop constraint if exists saved_videos_requested_quality_check;
  alter table public.saved_videos
    add constraint saved_videos_requested_quality_check
    check (requested_quality in ('best', '1080p', '720p', '480p'));
end $$;

create unique index if not exists saved_videos_canonical_format_quality_idx
  on public.saved_videos (canonical_url, requested_format, requested_quality);

create index if not exists saved_videos_created_at_idx
  on public.saved_videos (created_at desc);
