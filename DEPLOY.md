# Deploy checklist (Vercel + Supabase)

Tick each box in order. Nothing here costs money on the free plans (Google Vision needs a billing account on file, but the first 1,000 images a month are free).

## 1. Database (Supabase)

- [ ] In **SQL Editor** the files below have been run, in this order (each one is safe to run twice):
  1. `supabase/schema.sql`
  2. `supabase/migrations/003_is_shared.sql`
  3. `supabase/migrations/004_delete_functions.sql`
  4. `supabase/migrations/005_slips_storage.sql`
  5. `supabase/migrations/006_settle_items.sql`
  (If the database is older than the schema's current version, run `002a` then `002b` first.)
- [ ] **Do NOT run** `migrations/003_add_is_settled.sql` or `migrations/005_slips_bucket.sql`. They are old experiments; the second one opens the slip storage to everyone. Delete both files so nobody runs them by accident.
- [ ] Run `supabase/verify.sql`. **Every line must be ✅.** A ❌ line names the file that fixes it.

## 2. Security before real data goes in

- [ ] **Google key:** you can keep using the existing key. What Vercel needs is the value of `GOOGLE_SERVICE_ACCOUNT_JSON` in your local `.env` (copy everything after the `=`; it is already the one-line base64 form). If the key was ever shared or copied somewhere you are unsure about, replace it: Google Cloud Console → IAM & Admin → Service Accounts → `wealth-planner-bot` → Keys → *Add key → JSON*, delete the old key, and convert the new file with:
  ```powershell
  [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\keys\new-key.json"))
  ```
  Never put the key (or the `.env` file) in Git; `.gitignore` already blocks it.
- [ ] Google Cloud: enable **Cloud Vision API** for the project (it may ask for a billing account) and set a budget alert (e.g. 1 USD).
- [ ] **Sign-ups:** after you (and your partner, if she wants her own login) have created accounts, switch off *Authentication → Sign In / Providers → Email → Allow new users to sign up*. Otherwise anyone who finds the URL can register (they cannot see your data, but they would use your free quota).
- [ ] `NODE_TLS_REJECT_UNAUTHORIZED=0` exists only in the local `dev` script. Never add it to Vercel.

## 3. Put the code on GitHub (private repository)

```powershell
cd E:\wealth-planner-app
git init -b main
git add .
git status        # read the list: there must be NO .env, *.traineddata, *.csv or key file
git commit -m "wealth-planner-app"
```
Create an empty **private** repository on github.com, then:
```powershell
git remote add origin https://github.com/<your-name>/wealth-planner-app.git
git push -u origin main
```

## 4. Vercel

- [ ] vercel.com → *Add New → Project* → import the repository. Framework is detected as Nuxt; leave build settings alone.
- [ ] *Environment Variables* (Production):
  | Name | Value |
  |---|---|
  | `SUPABASE_URL` | Project URL from Supabase |
  | `SUPABASE_KEY` | the publishable / anon key (never the secret / service-role key) |
  | `OCR_PROVIDER` | `vision` |
  | `GOOGLE_SERVICE_ACCOUNT_JSON` | the one-line base64 from step 2 |
- [ ] Deploy. Then *Settings → Functions → Function Region*: choose **Singapore (sin1)** if offered (same region as the database).

## 5. After the first deploy

- [ ] Supabase → *Authentication → URL Configuration*: **Site URL** = your Vercel address (`https://….vercel.app`) and add the same address under *Redirect URLs*.
- [ ] Open the site on your phone, sign in once. In the browser menu choose *Add to Home Screen*.
- [ ] Smoke test (this is the first time the app meets the real services together, so go through all of it):
  - [ ] sign in, create a wallet (name it with "SCB" / "ไทยพาณิชย์" to be the default)
  - [ ] record an expense (personal) and one split 50/50; check the wallet balance moved
  - [ ] History: open a row, edit it, delete it (deleting goes through database functions)
  - [ ] Tick PENDING → PAID on a split item; the wallet and the Rin balance both change; tick back
  - [ ] Attach a slip photo: amount and date appear in the form; open it later from History
  - [ ] Analytics page loads; "ตั้งงบ" on a suggestion creates a budget
  - [ ] (optional) Import your old sheet from the Import page

## 6. Keep in mind

- **Backups:** the free Supabase plan does not give you automatic downloadable backups (check *Database → Backups* in your project). Export the tables now and then (Table Editor → Export as CSV).
- **Idle projects pause** after about a week without use on the free plan; opening the dashboard and pressing *Restore* brings it back with the data.
- Vercel *Hobby* is for personal, non-commercial use, which is exactly this.
- If something fails after deploying: Vercel → project → *Logs* shows server errors; the browser console (F12) shows the rest. Send the message with any keys or tokens removed.
