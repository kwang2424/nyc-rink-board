"""Pull rink schedules from public Google Calendar feeds into sessions.js.

Run:  pip install -r scripts/requirements.txt && python scripts/update_schedules.py
The GitHub Action in .github/workflows/update-schedules.yml runs this daily.

For each rink in RINKS, the script reads the rink's own schedule pages, finds the
Google Calendars embedded there, and keeps only calendars whose name matches one of
the activity rules. Events inside those calendars must also look like that activity,
and anything that looks like staff business (interviews, meetings...) is dropped, so
a rink putting unrelated entries on a public calendar doesn't leak onto the site.

The site uses these dated sessions instead of the weekly hours in rinks.js for any
day the feeds cover.
"""
import base64
import datetime as dt
import html
import json
import re
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
UA = {"User-Agent": "nyc-rink-board schedule updater"}

# Activity rules: (activity id, calendar-name pattern, pattern every event title must match)
RULES = [
    ("public", r"^public (session|skate)", r"skate|session"),
    ("adult", r"^adult public skate", r"adult"),
    ("hockey", r"^(stick n'? puck|adult open hockey|pond hockey)", r"puck|hockey"),
    ("figure", r"^freestyle", r"freestyle"),
    ("lessons", r"^learn to (skate|play)", r"learn|lesson|clinic|\bLT[SP]\b|class"),
]
# Events that are never skating sessions, whatever calendar they're on
NOT_A_SESSION = re.compile(
    r"interview|meeting|staff|training|orientation|private|rental|closed|cancel+ed|hiring|payroll", re.I)

RINKS = {
    "lefrak": {
        "pages": [
            "https://lakeside.prospectpark.org/master-schedule/rink-activities/",
            "https://lakeside.prospectpark.org/master-schedule/oval-rink-activities/",
            "https://lakeside.prospectpark.org/activity/adult-public-skate/",
            "https://lakeside.prospectpark.org/activity/stick-and-puck/",
            "https://lakeside.prospectpark.org/activity/freestyle-figure-skating/",
        ],
        # used only if none of the pages can be read
        "fallback": [
            "028a6e53d5001dd3c5639906d7a806cbbbf9a5802662ea1f66dff50b902fd0d0@group.calendar.google.com",
            "28a8343cd30895c12e7d8ecf6eb09c6ec8ee37a6035321fc54feb471c700a0ab@group.calendar.google.com",
            "1c2f7c1e6025508f59dafdf7ac44256837567031d1726ed7567b51fc5a9f4924@group.calendar.google.com",
            "7a9485921144058e6d6f6dc2f355a9883278755e7a2f9191b67cd588f8a61102@group.calendar.google.com",
            "c867962d91695866415dc49b522ab656a64ea55a54eda38d250ee1cee1794a0c@group.calendar.google.com",
            "2da60a9f95c34d550eb6b2d0916dfc2b8464d3e8bb6094ca655b3245f6cb8480@group.calendar.google.com",
            "2eaa4ef7a43685cad25d1c55871685c05460808048c7aea8a1da67bde1b7abdd@group.calendar.google.com",
            "c1bbddd06ca5925187910ab10e4905e4a53180734d5bd02c8f1a03cb02da8f47@group.calendar.google.com",
            "2d585c3b61437b770212b82b13fab6676afa02f17cd5236fffccb010b1bfc645@group.calendar.google.com",
            "bc0cdbb07efa540adbf047e0ae5b87a4f17eb7623c7b583fdb6490aadd9e8e48@group.calendar.google.com",
            "0782921a82d2943001de579554f5c281697741660e57a2df2aad51476efe728a@group.calendar.google.com",
            "5a524ec225fa16aa577ded396f7e4e6ff77895d83401051285c0ed37bca60cdf@group.calendar.google.com",
        ],
    },
}


def get(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.read()
        except Exception as e:  # Google rate-limits bursts with 429s
            if attempt == 3:
                raise
            print(f"  retrying {url[:60]}… ({e})", file=sys.stderr)
            time.sleep(5 * (attempt + 1))


def embedded_calendars(pages):
    """Calendar ids from Google Calendar embeds on the rink's pages."""
    ids, read = [], 0
    for page in pages:
        try:
            text = html.unescape(get(page).decode("utf-8", "ignore"))
            read += 1
        except Exception as e:
            print(f"! could not read {page}: {e}", file=sys.stderr)
            continue
        for m in re.finditer(r"https://calendar\.google\.com/calendar/embed\?[^\"'<> ]+", text):
            for src in urllib.parse.parse_qs(urllib.parse.urlparse(m.group(0)).query).get("src", []):
                try:
                    cid = base64.b64decode(src + "=" * (-len(src) % 4)).decode()
                except Exception:
                    cid = src
                if "@" in cid and "#holiday" not in cid and cid not in ids:
                    ids.append(cid)
    return ids, read


def hhmm(t, day):
    """HH:MM, capped at 24:00 for sessions that run past midnight."""
    return "24:00" if t.date() > day else t.strftime("%H:%M")


def main():
    today = dt.datetime.now(NY).date()
    end = today + dt.timedelta(days=DAYS_AHEAD)
    sessions, failed, dropped = {}, set(), 0

    for rink, cfg in RINKS.items():
        ids, read = embedded_calendars(cfg["pages"])
        if not read:
            print(f"! {rink}: no schedule pages readable, using last known calendars", file=sys.stderr)
            ids = cfg["fallback"]
        print(f"{rink}: {len(ids)} calendars embedded")
        seen_acts = set()
        for cid in ids:
            try:
                cal = icalendar.Calendar.from_ical(get(
                    "https://calendar.google.com/calendar/ical/" + urllib.parse.quote(cid) + "/public/basic.ics"))
            except Exception as e:
                print(f"  ! {cid[:16]}…: {e}", file=sys.stderr)
                failed.add(cid)
                continue
            finally:
                time.sleep(1)
            name = str(cal.get("X-WR-CALNAME", "")).strip()
            rule = next((r for r in RULES if re.search(r[1], name, re.I)), None)
            if not rule:
                print(f"  - skip {name!r}")
                continue
            act, _, title_pat = rule
            seen_acts.add(act)
            n = 0
            for ev in recurring_ical_events.of(cal).between(today, end + dt.timedelta(days=1)):
                s, e = ev["DTSTART"].dt, ev["DTEND"].dt
                if not isinstance(s, dt.datetime) or str(ev.get("STATUS", "")).upper() == "CANCELLED":
                    continue  # all-day notes and cancelled sessions
                s, e = s.astimezone(NY), e.astimezone(NY)
                day = s.date()
                if day < today or day > end:
                    continue
                title = " ".join(str(ev.get("SUMMARY", "")).split()) or name
                if NOT_A_SESSION.search(title) or not re.search(title_pat, title, re.I):
                    dropped += 1
                    continue
                sessions.setdefault(rink, {}).setdefault(act, []).append(
                    [day.isoformat(), s.strftime("%H:%M"), hhmm(e, day), title])
                n += 1
            print(f"  + {act:8} {name}: {n} sessions")

    for acts in sessions.values():
        for lst in acts.values():
            lst.sort()
            lst[:] = [x for i, x in enumerate(lst) if i == 0 or x != lst[i - 1]]  # same session on two calendars

    if not sessions:
        sys.exit("No sessions found; leaving sessions.js unchanged.")
    if failed:
        print(f"! {len(failed)} calendar(s) could not be read this run", file=sys.stderr)

    data = {"from": today.isoformat(), "to": end.isoformat(), "sessions": sessions}
    with open(OUT, "w") as f:
        f.write("// Generated by scripts/update_schedules.py from the rinks' public Google Calendars. Do not edit by hand.\n")
        f.write("const SESSIONS=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
        # on its own line so the daily job can skip commits where only this changed
        f.write('SESSIONS.updated="' + dt.datetime.now(NY).strftime("%Y-%m-%d %H:%M") + '";\n')
    total = sum(len(v) for a in sessions.values() for v in a.values())
    print(f"wrote {OUT}: {total} sessions, {today} to {end} ({dropped} non-session entries dropped)")


if __name__ == "__main__":
    main()
