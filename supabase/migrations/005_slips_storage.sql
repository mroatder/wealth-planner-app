-- Private storage for bank-slip images.
--   * bucket "slips" is NOT public: nobody can open a slip from a guessed link
--   * each user may read and upload only inside their own folder  slips/<user id>/...
-- The app uploads with the signed-in user's session and shows slips through short-lived signed links.
-- Safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slips', 'slips', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Remove the loose policies from the older 005_slips_bucket.sql (please do not run that file any more):
-- they let ANYONE upload to the bucket and let any signed-in user change or delete anybody's slip.
drop policy if exists "Allow Slips Insert" on storage.objects;
drop policy if exists "Authenticated Slips Update" on storage.objects;
drop policy if exists "Authenticated Slips Delete" on storage.objects;
drop policy if exists "Authenticated Slips Insert" on storage.objects;
drop policy if exists "Public Slips Select" on storage.objects;
drop policy if exists "Public Slips Insert" on storage.objects;
drop policy if exists "Public Slips Update" on storage.objects;

drop policy if exists "slips: read own folder" on storage.objects;
create policy "slips: read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'slips' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "slips: upload to own folder" on storage.objects;
create policy "slips: upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'slips' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Optional clean-up of the old base64 fallback (frees database space; the images stored that way are lost):
-- update public.transactions set slip_url = null where slip_url like 'data:%';
