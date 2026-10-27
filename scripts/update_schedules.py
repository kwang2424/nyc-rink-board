"""Pull rink schedules from public Google Calendar feeds into sessions.js.

Run:  pip install -r scripts/requirements.txt && python scripts/update_schedules.py
The GitHub Action in .github/workflows/update-schedules.yml runs this daily.

Each feed maps to a rink id and an activity id from rinks.js. The site uses these
dated sessions instead of the weekly hours in rinks.js for any day the feeds cover.
"""
import datetime as dt
import json
import sys
import time
import urllib.parse
import urllib.request
import zoneinfo

import icalendar
import recurring_ical_events

NY = zoneinfo.ZoneInfo("America/New_York")
DAYS_AHEAD = 60
OUT = "sessions.js"

# (rink id, activity id, Google Calendar id, label shown on the site)
FEEDS = [
    # LeFrak Center at Lakeside, Prospect Park
    ("lefrak", "public", "calendarlefraklakeside@gmail.com", "Covered Rink"),
    ("lefrak", "public", "28a8343cd30895c12e7d8ecf6eb09c6ec8ee37a6035321fc54feb471c700a0ab@group.calendar.google.com", "Open Air Rink"),
    ("lefrak", "adult", "1c2f7c1e6025508f59dafdf7ac44256837567031d1726ed7567b51fc5a9f4924@group.calendar.google.com", "Covered Rink"),
    ("lefrak", "adult", "7a9485921144058e6d6f6dc2f355a9883278755e7a2f9191b67cd588f8a61102@group.calendar.google.com", "Open Air Rink"),
    ("lefrak", "hockey", "c867962d91695866415dc49b522ab656a64ea55a54eda38d250ee1cee1794a0c@group.calendar.google.com", "Stick n' Puck"),
    ("lefrak", "hockey", "2da60a9f95c34d550eb6b2d0916dfc2b8464d3e8bb6094ca655b3245f6cb8480@group.calendar.google.com", "Open Hockey"),
    ("lefrak", "hockey", "2eaa4ef7a43685cad25d1c55871685c05460808048c7aea8a1da67bde1b7abdd@group.calendar.google.com", "Pond Hockey"),
    ("lefrak", "figure", "c1bbddd06ca5925187910ab10e4905e4a53180734d5bd02c8f1a03cb02da8f47@group.calendar.google.com", "Covered Rink"),
    ("lefrak", "figure", "2d585c3b61437b770212b82b13fab6676afa02f17cd5236fffccb010b1bfc645@group.calendar.google.com", "Open Air Rink"),
    ("lefrak", "lessons", "bc0cdbb07efa540adbf047e0ae5b87a4f17eb7623c7b583fdb6490aadd9e8e48@group.calendar.google.com", "Learn to Skate"),
    ("lefrak", "lessons", "0782921a82d2943001de579554f5c281697741660e57a2df2aad51476efe728a@group.calendar.google.com", "Learn to Skate"),
    ("lefrak", "lessons", "5a524ec225fa16aa577ded396f7e4e6ff77895d83401051285c0ed37bca60cdf@group.calendar.google.com", "Learn to Play Hockey"),
]


def fetch(cal_id):
    url = "https://calendar.google.com/calendar/ical/" + urllib.parse.quote(cal_id) + "/public/basic.ics"
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "nyc-rink-board schedule updater"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:  # Google rate-limits bursts with 429s
            if attempt == 3:
                raise
            print(f"  retrying {cal_id[:12]}… ({e})", file=sys.stderr)
            time.sleep(5 * (attempt + 1))


def hhmm(t, day):
    """Minutes-of-day as HH:MM, capped at 24:00 for sessions that run past midnight."""
    if t.date() > day:
        return "24:00"
    return t.strftime("%H:%M")


def main():
    today = dt.datetime.now(NY).date()
    end = today + dt.timedelta(days=DAYS_AHEAD)
    sessions = {}
    failed = []
    for rink, act, cal_id, label in FEEDS:
        try:
            cal = icalendar.Calendar.from_ical(fetch(cal_id))
        except Exception as e:
            print(f"! {rink}/{act} {label}: {e}", file=sys.stderr)
            failed.append(f"{rink}/{act}")
            continue
        n = 0
        for ev in recurring_ical_events.of(cal).between(today, end + dt.timedelta(days=1)):
            s, e = ev["DTSTART"].dt, ev["DTEND"].dt
            if not isinstance(s, dt.datetime):
                continue  # all-day notes, not sessions
            s, e = s.astimezone(NY), e.astimezone(NY)
            if str(ev.get("STATUS", "")).upper() == "CANCELLED":
                continue
            day = s.date()
            if day < today or day > end:
                continue
            title = str(ev.get("SUMMARY", "")).strip() or label
            sessions.setdefault(rink, {}).setdefault(act, []).append(
                [day.isoformat(), s.strftime("%H:%M"), hhmm(e, day), title])
            n += 1
        print(f"{rink}/{act} {label}: {n} sessions")
        time.sleep(1)

    for acts in sessions.values():
        for lst in acts.values():
            lst.sort()
            # drop exact duplicates (the same session listed on two calendars)
            lst[:] = [x for i, x in enumerate(lst) if i == 0 or x != lst[i - 1]]

    if failed and not sessions:
        sys.exit("No feeds could be read; leaving sessions.js unchanged.")

    data = {
        "from": today.isoformat(),
        "to": end.isoformat(),
        # a rink/activity whose feed failed falls back to the weekly hours in rinks.js
        "sessions": {r: {a: v for a, v in acts.items() if f"{r}/{a}" not in failed} for r, acts in sessions.items()},
    }
    with open(OUT, "w") as f:
        f.write("// Generated by scripts/update_schedules.py from the rinks' public Google Calendars. Do not edit by hand.\n")
        f.write("const SESSIONS=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
        # on its own line so the daily job can skip commits where only this changed
        f.write('SESSIONS.updated="' + dt.datetime.now(NY).strftime("%Y-%m-%d %H:%M") + '";\n')
    print(f"wrote {OUT}: {sum(len(v) for a in sessions.values() for v in a.values())} sessions, {today} to {end}")


if __name__ == "__main__":
    main()
