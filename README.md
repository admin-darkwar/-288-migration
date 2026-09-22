# SERVER 288 — Migration Registration

A free, multilingual (EN/AR/VI/DE/TL/ZH/KO/ES/FR) migration registration site,
matching the requirements spec. Static frontend + Google Apps Script backend +
Google Sheets database, deployable at zero cost.

## Files

| File | Purpose |
|---|---|
| `index.html` / `app.js` | Public registration form (also handles update-link edits via `?update=ID`) |
| `admin.html` / `admin.js` | Admin dashboard (Google sign-in + password, stats, filters, lock/unlock, CSV export) |
| `styles.css` | Shared dark HUD-themed styling, RTL-aware |
| `i18n.js` | Translation dictionary for all 9 languages |
| `Code.gs` | Google Apps Script backend — paste into an Apps Script project |

## Decisions made where the spec was ambiguous or silent

Flagging these explicitly so you can override any of them:

1. **Nine languages, not five.** The spec's language list (§2) and its summary
   (§21/§23) disagreed — one said 9, the other said 5. I implemented all 9
   listed in §2 (added Chinese, Korean, Spanish, French). Delete the extra
   dictionaries in `i18n.js` and their `<option>`s if you only want the
   original five.
2. **Server 288 excluded from the Source Server dropdown** — you can't
   migrate from 288 to 288.
3. **"Cancelled" status** (mentioned in §12 but never explained) is wired up
   as a third admin-settable status alongside Locked/Unlocked, for cases
   where a registration needs to be voided without deleting the row.
4. **Group semantics**: one submission = one row, with `GroupSize` recording
   total headcount. "Total Players" in the dashboard means *submissions*,
   not headcount — add a "Total headcount" stat if you want group members
   counted individually.
5. **Update link has no separate password** — anyone holding the link can
   edit that registration. This is stated explicitly to players on the
   success screen. There's no link-recovery flow (no email captured), so a
   lost link means contacting an admin, who can look it up by Migration ID
   or player name and re-share it, or just tell the player to re-register
   once you cancel the old one.
6. **Duplicate-check race condition** is handled with `LockService` in
   `Code.gs` so two simultaneous submissions with the same Migration ID
   can't both slip through.
7. **Admin dual auth** is real: an admin password (checked server-side
   against a Script Property, never shipped in frontend code) *and* a
   6-digit one-time code emailed to an allow-listed address, valid for 5
   minutes. Code requests are throttled (5 per email per 10 minutes) to
   limit abuse. This avoids needing a Google Cloud OAuth client for a
   free/hobby deployment; if you'd rather use "Sign in with Google" instead
   of email codes, that's a straightforward swap — ask and I can wire it
   back in.
8. **Excel export**: CSV export is built client-side. For a true `.xlsx`,
   the dashboard links admins straight to the underlying Google Sheet
   (they already have access via Google auth) to use File → Download →
   Microsoft Excel. This avoids bundling a spreadsheet-writing library for
   a feature Google Sheets already provides for free.
9. **No CAPTCHA/rate-limiting** is included — flagged as a gap in the earlier
   review. Cheapest mitigation for a free stack: add Google's reCAPTCHA v3
   client-side and check the score in `doPost` before writing to the Sheet.

## Deploy the backend (Google Apps Script)

1. Create a new Google Sheet — this is your private database.
2. In the Sheet: **Extensions → Apps Script**. Delete the placeholder code
   and paste in `Code.gs`.
3. **Project Settings → Script Properties**, add:
   - `SHEET_ID` — the Sheet's ID (from its URL)
   - `ADMIN_PASSWORD` — a password of your choosing
   - `ADMIN_EMAILS` — comma-separated Google account emails allowed to log
     into the dashboard
4. Run the `setup` function once (top toolbar → select `setup` → Run) to
   create headers. Approve the permission prompts.
5. **Deploy → New deployment → Web app.**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the deployment URL (ends in `/exec`).

## Configure the frontend

1. In `app.js`, set `CONFIG.API_URL` to the deployment URL from above.
2. In `admin.js`, set the same `API_URL`, plus:
   - `SHEET_URL` — the Google Sheet's URL, for the admin's Excel-export shortcut.

No OAuth client setup is needed — admin sign-in is password + emailed
one-time code. When you run `setup`/first deploy, Apps Script will ask you
to authorize the "send email" permission (`MailApp`); accept it, since
that's what delivers the codes.

**Email quota to be aware of:** codes are sent from the Google account that
owns the Apps Script project. A personal Gmail account gets ~100
`MailApp` sends per day; a Google Workspace account gets ~1,500/day. Fine
for an admin team of any realistic size, but worth knowing if you ever
loop email-based notifications into the same script.

## Host it for free

Push these files to a GitHub repo and enable **GitHub Pages** (Settings →
Pages → deploy from branch), or drag the folder into **Netlify** or
**Cloudflare Pages**. No build step is required — it's plain HTML/CSS/JS.

## Known Apps Script constraints worth knowing about

- **Execution limits**: 6-minute max execution per request, and daily quotas
  that are generous for a hobby/community deployment but not infinite —
  worth knowing if a migration wave brings a burst of simultaneous submissions.
- **CORS**: the frontend sends `Content-Type: text/plain` on POST requests
  specifically to avoid triggering a CORS preflight `OPTIONS` request, which
  Apps Script web apps don't handle. Don't change that content type without
  testing.
- **Sheet as database**: fine at the scale of a game server's population;
  if it ever gets slow, the biggest lever is trimming the linear duplicate-ID
  scan in `handleSubmit_`/`handleUpdate_` down to a maintained ID→row index.

## What to test before going live

- Submit a registration end-to-end, confirm the row appears in the Sheet and
  the success screen shows a working update link.
- Open the update link, edit a field, save, confirm the Sheet updates and
  `UpdatedAt` changes.
- Lock a registration from the admin dashboard, then try to edit it via the
  update link — confirm it's blocked with the translated message.
- Submit the same Migration ID twice — confirm the second is rejected.
- Switch languages, including Arabic, and confirm layout mirrors correctly.
- Load the site on an actual phone, not just a resized browser window.
