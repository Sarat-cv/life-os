# Life OS pilot

An iPhone web app (added to the Home Screen) with a life buddy who checks in at times you choose. This repo holds the whole pilot: the app, the database and the backend.

## What's in here

| Folder | What it is |
| --- | --- |
| `web/` | The app people install. `index.html` is built from `index.src.html` and `design/` |
| `design/` | The onboarding and chat screens (the same files as the design canvas) |
| `supabase/migrations/` | The story file: tables, access rules, saving chats, deleting an account, the 5-minute timer |
| `supabase/functions/` | Backend: `tick` sends due chat messages and reminders, `vapid` gives the app the public push key |
| `supabase/email-templates/` | The login email with the 6-digit code |
| `tests/` | Push encryption test, scheduler test, full app test |
| `.github/workflows/deploy.yml` | Deploys everything on each push to `main` |

## One-time setup (about 20 minutes)

You never paste a secret key into a chat or into this code. Secrets go only into GitHub or Supabase settings.

**Supabase**
1. Create a project named `life-os-pilot` in the Mumbai region. Save the database password in a password manager.
2. Project Settings → API: copy the **Project URL** and the **publishable (anon) key** into `web/config.js`. Both are safe to publish.
3. Authentication → Sign In / Providers: turn on **Allow anonymous sign-ins**. For the pilot there's no email code: each phone gets a private account on first open, and the email people type is saved on their profile. (To bring codes back later, set `loginWithCode: true` in `web/config.js`, connect an email sender under SMTP settings, and paste `supabase/email-templates/code.html` into the Magic Link and Confirm signup emails.)
4. Authentication → URL Configuration: set Site URL to your app address (step 3 under GitHub).
5. Only needed for email codes or reminder emails: Authentication → Emails → SMTP settings, connect an email sender. Supabase's built-in email only sends to your own team, 2 an hour.
6. Account → Access Tokens: create a token named `github-deploy` (you'll paste it into GitHub, not here).

**GitHub**
1. Create a repo named `life-os` and push this code to `main`.
2. Settings → Secrets and variables → Actions:
   - Secret `SUPABASE_ACCESS_TOKEN`: the token from Supabase step 6
   - Secret `SUPABASE_DB_PASSWORD`: the database password
   - Variable `SUPABASE_PROJECT_REF`: the part of the Project URL before `.supabase.co`
3. Settings → Pages → Source: **GitHub Actions**. The app address will be `https://<your-username>.github.io/life-os/`. On a free GitHub plan, Pages needs the repo to be public. The code holds no secrets, so that's safe; Netlify is the alternative if you want it private.
4. Push to `main` (or Actions → Deploy → Run workflow). The workflow sets up the database, the timer and the backend, then publishes the app.

**Optional backend settings** (Supabase → Edge Functions → Secrets)
- `APP_URL`: the app address, used in emails
- `VAPID_SUBJECT`: `mailto:` plus your email, so Apple can contact you about push
- `RESEND_API_KEY` and `RESEND_FROM`: email the chat message to people who turned notifications off

## Testing on your own iPhone

Open the app address with `?test=1` on the end, once, in Safari. Test mode offers a chat time 3 minutes away and adds "Start this chat now" on the home screen, so you don't have to wait a day between chats. `?test=0` turns it off.

## Working on it

```
python3 tools/build.py                                            # rebuild web/index.html after changing design/ or index.src.html
node --experimental-strip-types tests/webpush.test.ts             # push encryption
node --experimental-strip-types tests/tick.test.ts                # scheduler
node tests/e2e.js                                                 # the whole app, against a mock backend (needs Playwright)
```

## Where the data is

Everything lives in Supabase (Mumbai). To follow each person's journey, open Table Editor → `journey_overview` (one row per person: where they are, last seen, chats done) and `events` (every screen, chat step and answer, in order; filter by `user_id`). Each person can read only their own rows. Facts from chats are saved as dated story markers: a changed answer marks the old one as replaced, never deletes it. People can download their story or delete everything from the menu on the home screen. Without email codes an account lives on one phone: deleting the app from the Home Screen loses the link to it. To see how the pilot is going, use Supabase → Table Editor (`chats`, `bug_reports`, `safety_events`).

## Not built yet

- Week 1 after chat 5: the step tracker, morning nudge and evening check (milestone M6)
- The AI writer and checker: chats use the tested scripted lines for now; Claude rewording comes next
- An alert to the founder when someone sees the crisis screen (open decision)
