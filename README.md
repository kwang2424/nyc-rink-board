# NYC Rink Board

Public skate schedules for NYC ice rinks on one timeline, sorted by distance, with what's open right now. Filter by activity: public skate, lessons, hockey, freestyle or adults-only skate.

Live site: https://kwang2424.github.io/nyc-rink-board/

## Files

- `index.html`: page markup
- `style.css`: styles (light and dark themes)
- `rinks.js`: **all rink data**: hours, season dates, prices, links, plus the neighborhood list
- `app.js`: schedule logic, filters, "Use my location"
- `sessions.js`: generated dated sessions from rink calendars (see below)
- `scripts/`: the calendar update script

No build step. Open `index.html` in a browser, or run `python3 -m http.server` in this folder.

## Updating hours

Edit `rinks.js` and bump `UPDATED` at the top.

- `wk` is Sunday through Saturday. Each entry is one or more `"HH:MM-HH:MM"` ranges separated by commas. `""` means no public skate that day, and `24:00` means midnight.
- `over` replaces the weekly hours for a date range, e.g. holiday hours or a second rink opening.
- `conf` sets the label: `confirmed` (2026–27 hours), `posted` (official hours, opening date TBA), `last` (based on last season), `vary`.
- `start` / `end` are the season dates. Use `start:null` with a `startLabel` when the opening date isn't announced.

## Updating activities

Activities live in `ACTS` at the bottom of `rinks.js`, keyed by rink id. Each entry needs `info` and `url`. Add `wk` (same format as above, with optional `start`, `end` and `over`) when the rink posts fixed times, and the activity gets its own timeline. Without `wk`, the rink shows as "offered" with a link to its calendar.

## Live calendar data

Some rinks publish their schedules as public Google Calendars. `scripts/update_schedules.py` reads those feeds and writes `sessions.js` with every dated session for the next 60 days. On days the feeds cover, the site uses these sessions instead of the weekly hours in `rinks.js`, and the rink is labeled "Live from rink calendar".

- Feeds are listed in `FEEDS` at the top of the script, each mapped to a rink id and activity.
- `.github/workflows/update-schedules.yml` runs the script every morning and commits only when a schedule changed. Run it any time from the Actions tab with **Run workflow**.
- Run it locally: `pip install -r scripts/requirements.txt && python scripts/update_schedules.py`

Currently live: LeFrak Center at Lakeside (public skate, adults-only, stick & puck, open hockey, freestyle, Learn to Skate, Learn to Play). Its calendars are embedded on lakeside.prospectpark.org; the calendar IDs come from those embeds.

## Hosting

Served by GitHub Pages from the `main` branch root (Settings → Pages → Deploy from a branch → `main` / `/ (root)`).
