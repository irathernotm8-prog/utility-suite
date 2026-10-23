# Touchline

Football scores, tables, match stats, squads and player histories for every league and every season. Touchline is the desktop successor to the Football Hub site: same competitions, same Hall of Fame, but live data instead of hand-maintained JSON, so nothing needs reworking when a new season starts.

## What it does

- **Matchday**: every match on any day, grouped by competition, with your competitions first. Live minute and score, red cards, a date strip and calendar, a filter box, a Live-only toggle, and "Your teams today" cards. Refreshes every 30 seconds while anything is live.
- **Competitions**: everything FotMob covers (300+ competitions by country). Star any to follow it; set their order for Matchday and the sidebar.
- **A competition**: table (overall, home, away, form, xG with expected points), group tables, fixtures by matchday, knockout bracket with aggregates, stat leaders (goals, assists, xG, rating and ~45 more, each with a full ranked list), and the roll of honour back to the first season (Premier League to 1888/89) with a most-titles chart. **Any past season** from the season picker.
- **A match**: score, scorers, venue, referee, attendance and weather; momentum chart; timeline (goals with assists and xG, cards, subs, VAR); lineups on a pitch with ratings, events, subs, coach and absentees; full team stats; shot map; head-to-head; the league table with both teams highlighted. Live matches refresh every 20 seconds.
- **A team**: next match, recent results, upcoming fixtures, mini table, top players, venue; every fixture across competitions; squad with ratings and injuries; trophy cabinet; league finishes by season (chart and table); managers; club legends from the Hall of Fame.
- **A player**: profile (age, height, foot, value, contract), this season's numbers, recent matches with ratings, market value history, positions, style comparison; **deep stats for any season and competition** with percentiles and a shot map; season-by-season club and international career with per-competition breakdowns; managerial career; trophies; and the **historical record from Wikidata** (every club spell with appearances and goals) for older careers FotMob doesn't fully cover.
- **Legends**: the 169-player Football Hub Hall of Fame with its sepia/gold photos, filterable by position and nation, each with club career, international record and Wikidata appearances/goals.
- **XI Builder**: eight formations; pick from search (anyone, current or past), a squad, or the legends; save as many XIs as you like; copy as text.
- **Following**: your teams (form, last and next match), players and competitions.
- **Live widget** (⌘⇧L / Ctrl+Shift+L, or the picture-in-picture button in the title bar): a small floating window with the day's scores for your competitions and teams. Live matches first, goal flashes, All / Live / My teams filters, day arrows, pin on top. Click a match to open it in Touchline. It remembers its spot and reopens on launch.
- **Trophy art**: the Football Hub trophy images in team trophy cabinets (with a shelf of the club's major wins), player trophies and competition headers.
- **Alerts**: notifications for kick-off, goals, red cards and full-time for teams you follow.
- **Search** (⌘K / Ctrl K or /): players, teams, competitions and legends.
- **Offline**: everything you open is saved. If the network drops, Touchline shows the saved copy and says when it's from. If FotMob is down, Matchday and tables come from ESPN instead.

## Why it won't need reworking each season

Football Hub stored fixtures, squads and title histories as files per competition and season, plus updater scripts with season strings and expected match counts. Touchline stores none of that:

- Competitions are FotMob ids (`store.js → DEFAULT_LEAGUES`). Seasons come from the competition itself (`allAvailableSeasons`), and "current" is whatever FotMob calls latest.
- Squads, fixtures, tables and honours are fetched when you open a page and cached with lifetimes that suit them (`src/data/index.js`).
- Promoted and relegated clubs, new formats (the 36-team Champions League, a 48-team World Cup) and new competitions simply appear.

The only curated data left is the Hall of Fame (`src/data/legends.json` and `src/renderer/legends/`), which doesn't change by season.

## Data sources

| Source | Used for | Notes |
|---|---|---|
| FotMob (`www.fotmob.com/api/data/…`, `data.fotmob.com/stats/…`) | Almost everything | Unofficial, no key. Requests are paced and cached. |
| ESPN (`site.api.espn.com`) | Backup scores and tables | Only when FotMob fails. Mapping in `src/data/espn.js → SLUGS`. |
| Wikidata (`query.wikidata.org`) | Historical careers | Club and national-team spells with apps and goals. |
| Football Hub | Hall of Fame | Bundled; photos converted to WebP. |

## Code map

```
src/main.js            window, menu, IPC (data:*, store:*, app:*)
src/preload.js         window.tl bridge (the window has no Node or network)
src/store.js           settings.json: theme, follows, alerts, saved XIs
src/alerts.js          match notifications for followed teams
src/widget.js          the live widget window (bounds, pin, reopen on launch)
src/data/http.js       requests: timeouts, retries, per-host pacing, gzip
src/data/cache.js      disk cache with lifetimes and offline fallback
src/data/normalize.js  FotMob payloads → Touchline shapes (pure; tested)
src/data/index.js      the data API: lifetimes, fallbacks, SCHEMA version
src/data/espn.js       backup feed
src/data/wikidata.js   career history
src/data/images.js     tl-img:// protocol: crests and photos cached on disk
src/data/legends.json  Hall of Fame (names, positions, careers, club aliases)
src/renderer/          index.html, styles.css, ui.js (helpers), charts.js (SVG),
                       app.js (shell, router, clicks), palette.js (search),
                       views/*.js (one file per page), widget.html + widget.js,
                       legends/*.webp, trophies/*.webp, fonts/
build/icon.png         app icon (build/make-icon.py regenerates it)
test/run.js            npm test: normalizers, cache, Wikidata shaping, legends
test/fixtures/         saved FotMob responses (gzipped)
test/e2e/              drives every page in the real window and screenshots it
```
