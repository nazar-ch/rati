# rati website — plan (first iteration)

The public site: showcases what makes rati different through interactive examples, hosts
the docs ([guide](./public/guide.md), [reference](./public/reference.md)), and is itself
built with rati — every page a rati route, every demo a rati island, SSR'd by the
mechanism it demonstrates. Concept chosen: **the Departures Board** (one continuous
transit app as the running example) **plus a network-conditions panel** on every
interactive demo. Public release is not expected from this iteration; the site evolves
with the docs.

Implementation tasks live in [public-prep-tasks.md](./public-prep-tasks.md) (SITE-*).

---

## 1. Identity & voice

**Name story.** Rati — the goddess of delight and pleasure. The interest is mythological,
not religious, and the site treats it that way: one quiet line, no iconography beyond the
mark. The line (About/footer, and the npm README):

> Named for Rati — delight, by design. Websites should be beautiful, well-behaved, and a
> pleasure to use; so should the code behind them.

**The mark.** Rati rides a parrot — and a parrot already lives in rati's dev banner
(`🦜 rati LOCAL`). The logo direction is a small, geometric parrot: adult, colorful,
slightly wry. Palette can follow the plumage — a saturated green/teal + one hot accent
(rose/vermilion) on a near-black or paper-white ground. Pairs well with the split-flap
board aesthetic below.

**Visual hook.** The departures board is rendered as a **split-flap display** (Solari
board): rows flip as data resolves. It is the perfect visualization of rati's whole
pitch — a board is either showing you the answer or visibly flipping toward it; it never
shows you `undefined`. Split-flap flips also make *re-resolution* (input change, retry,
live updates) legible and satisfying.

**Voice.** Developer-to-developer, dry, concrete. Every showcase section opens from a
pain the reader has personally caused ("you've written this component"). No exclamation
marks, no mascot antics, no superheroes; wit lives in precision, not decoration. Code is
always real and always typed.

**Words we use / avoid.**

- Use: *data layer, declarative, resolved props, typed end-to-end, scope, island, route,
  source.*
- Avoid: *framework*, *blazing/blazingly*, *magic*, *simple* (show it instead), and any
  meta-talk about naming philosophy.

## 2. Reusable copy

**Tagline (hero, npm, README, meta description):**

> **rati — the declarative data layer for React.**
> Declare which data each screen needs. Components get clean, fully-loaded, fully-typed
> props — never a loading state.

**One-paragraph boilerplate (npm description, README opening, link previews):**

> rati is a declarative data layer for React, with typed routing and server rendering
> built around it. You describe a screen's data as a typed spec — inputs, then load
> levels that resolve as a visible waterfall — and rati turns it into clean, fully-loaded
> props. Loading and error states live in slots, once; types flow from your backend to
> your components without being written twice; routes are the same specs bound to URLs,
> and the server resolves and dehydrates them so the client never refetches.

**Three bullets (home, README):**

- **No loading states in components.** Pending and error handling are slots on the
  island, not branches in your JSX.
- **The waterfall is visible.** Parallel within a level, sequential across levels — where
  you declare a load *is* its scheduling.
- **Typed end to end.** Props are inferred from the spec; the spec is inferred from your
  API. Change a response type and the compiler finds every screen that cares.

## 3. The demo app — "the Board"

One coherent transit app threads through the whole site. Realistic, not real-time-fragile:

- **Dataset (bundled):** a snapshot-shaped network of ~15 real Swiss stations (Zürich HB,
  Bern, Basel SBB, Lugano, Interlaken Ost, …) with lines, platforms, and timetable
  *patterns* (e.g. IC 8 every 30 min). Departures are **generated relative to "now"** so
  the board is never empty and never stale. Plausibility over accuracy; a footnote says
  "schedule simulated".
- **Simulated API:** the site's data client (`site/api.ts`) serves the dataset through
  async functions with artificial latency/failures controlled by the network panel. Same
  functions run under SSR (deterministic, panel off), so dehydration demos are honest.
- **One truly live source:** the ticking clock (`Source<Date>`) plus a **delay drift
  feed** — a local `Source` that nudges simulated delays every few seconds so the board
  visibly lives. Optionally (flagged, degradable): a single page can hit the real
  `transport.opendata.ch` API to show the same scope code on real data.

**The network-conditions panel** — the site's signature device, docked on every demo:

- Latency slider (0–3000 ms) + jitter toggle.
- Failure mode: *off / fail next request / fail all / not-available* (exercises both
  `error.code` branches).
- Per-demo **replay** (re-mounts the island: fresh resolution, visible waterfall) and
  **reset**.
- Implementation: a plain external store (`NetworkConditionsStore`, uSES-read) that the
  simulated API consults; the panel is one component reused everywhere.

**The waterfall timeline** — second signature device: demos can render a live timeline of
the resolution (one bar per load, grouped by level, start/settle times) by instrumenting
the demo scopes' loads with a wrapper that reports to a store. (If this proves broadly
useful it can graduate into `rati/debug` later — see improvements §7 "dataTrace".)

## 4. Site structure

The site map, as its own routes table (dogfood from day one):

```tsx
export const routes = [
    route('/', 'home', HomePage),
    route('/board', 'board', BoardIndex),                       // station picker
    route('/board/:stationId', 'station', StationPage, {
        scope: stationScope, loading: BoardSkeleton, error: BoardError,
    }),
    route('/board/:stationId/compare/:otherId', 'compare', ComparePage, { … }),
    route('/pain/:slug', 'pain', PainPage, { scope: painScope, … }),   // the showcase pages
    route('/guide', 'guide', GuidePage, { scope: docScope, … }),        // rendered markdown
    route('/guide/:section', 'guide-section', GuidePage, { … }),
    route('/reference', 'reference', ReferencePage, { scope: docScope, … }),
    route('/about', 'about', AboutPage),
    route('*', '404', NotFoundPage),
] as const;
```

Navigation: **Home · The pains · The board · Guide · Reference · About**. The 404 page is
a split-flap board flipping to `DESTINATION NOT FOUND` — and is itself the error-slot
demo it links to.

## 5. Pages — purpose, copy, example, tasks

### 5.1 Home

**Purpose:** land the positioning in 10 seconds, prove it in 60.

**Structure & copy:**

1. **Hero.** Tagline (§2) over a live split-flap board resolving. The network panel is
   *right there* under the hero with a nudge: *"Drag the latency up. Watch what the
   component doesn't have to do."*
2. **The before/after.** The guide's opening `StationBoard` pair, side by side, headed:
   *"You have written this component. Every branch of it."* → *"Declare the data.
   Render the data. That's the whole component."*
3. **Three bullets** (§2), each linking to its pain page.
4. **It's rati all the way down.** *"This site is built with rati — every page is a
   route, every demo an island, and the HTML you were served was resolved and dehydrated
   by the same engine you're reading about. View source."*
5. Footer: name story line, parrot mark, GitHub/npm links.

**Example spec:** hero board = `heroScope` (station → departures, 2 levels) + clock
source; panel-wired; split-flap renderer.

**Tasks:** SITE-10 (hero board + split-flap component), SITE-11 (before/after code block
component with syntax highlighting), SITE-12 (home page assembly + copy).

### 5.2 The pains (`/pain/:slug`) — the core showcase

Seven pages, one per pain. Shared layout: **the pain** (familiar code, annotated) → **the
fix** (live demo + the rati code that runs it, verbatim) → **why it works** (three
sentences, link into the guide section). Every demo carries the network panel.

Each page below: slug — pain narrative (opening copy draft) — demo — tasks.

**P1 `spinner-dance` — "Loading states are not your component's job."**
Opening: *"Count the lines in your last data component that render data. Now count the
ones that babysit `isLoading`, `error`, and `data === undefined`. The ratio is the
problem."* Demo: the station board with `loading`/`error` slots; panel set to 2s latency
shows the skeleton once — the component code on screen contains zero conditionals. Break
the API → error slot with working `retry`; switch failure mode to *not-available* → the
"unknown station" branch. **Tasks:** SITE-20.

**P2 `hidden-waterfall` — "Your waterfall exists. You just can't see it."**
Opening: *"Chained `enabled:` flags and `!`s are a dependency graph wearing a disguise.
rati makes you write the graph — and then shows it to you."* Demo: station → (departures
∥ weather) scope rendered next to the **waterfall timeline**; a control swaps between two
scopes — `weather` declared on level 2 (parallel with departures) vs level 3 (after) —
and the timeline visibly changes shape. Copy under it: *"You just changed loading
strategy by moving a line."* **Tasks:** SITE-21 (timeline instrumentation + component),
SITE-22 (page).

**P3 `undefined-forever` — "Stop proving to the compiler what you already checked."**
Opening: *"`data?.station?.name ?? '…'` is not type safety; it's type apology."* Demo:
pre-rendered twoslash-style hover types over the before/after code — hover `station` in
the old version (`Station | undefined`), in the rati component (`Station`); a third
snippet shows a backend type change surfacing as a compile error in the component.
Static (build-time), no live TS needed. **Tasks:** SITE-23 (twoslash snippet pipeline),
SITE-24 (page).

**P4 `live-wire` — "Data that changes shouldn't need a useEffect."**
Opening: *"Subscriptions leak, reconnect logic multiplies, and the cleanup function is
always one refactor away from wrong. A source is subscribe/snapshot/attach — the island
owns the lifetime."* Demo: the live board — clock source + delay-drift source; departures
shift and flip in place. A mount/unmount toggle proves attach/detach (a connection
counter on the page). SSR note inline: *"the server ships this demo's loading slot —
sources are alive, HTML is not."* **Tasks:** SITE-25.

**P5 `route-to-nowhere` — "Links that can't dangle."**
Opening: *"Somewhere in your app there's a template literal building a URL to a page that
was renamed in March."* Demo: typed `<Link>` with a pre-rendered type error for a wrong
param; the station route's param flowing into the scope (edit the URL → island
re-resolves); prefetch-on-hover shown by a mini request log; the compare page
demonstrating `keepCurrentRoute` (split view, back/forward steps the focus). **Tasks:**
SITE-26 (compare page), SITE-27 (page + request log widget).

**P6 `double-fetch` — "Render on the server. Don't apologize on the client."**
Opening: *"Server-rendered, then refetched on hydration — the same JSON, twice, the
second time with a spinner. The server already knew."* Demo: this page is SSR'd with an
async load; a panel shows (a) the dehydrated payload extracted from the actual HTML you
received, (b) the client-side request log: zero fetches at hydration; a "re-run as SPA
navigation" button contrasts the client-side resolution. **Tasks:** SITE-28.

**P7 `prop-relay` — "Data that skips the middle managers."**
Opening: *"Four components pass `station` down so the fifth can read it. Three of them
have opinions about its type."* Demo: breadcrumb + footer widgets reading
`useScope(stationScope)` / `useRouteContext('station')` from deep inside the board page;
the code shows no props threaded through the layout. Note on the no-import-cycle
property (reader imports the scope, not the page). **Tasks:** SITE-29.

### 5.3 The board (`/board`, `/board/:stationId`)

The full app, playable: station picker (typed links), station page (the P1/P4 scopes
united), compare view (P5). It's the "everything together" proof and the place visitors
poke around. Departure rows link between stations, so navigation is constant and typed.
**Tasks:** SITE-30 (board index + station page), SITE-26 (compare).

### 5.4 Guide & Reference (`/guide`, `/reference`)

`docs/public/*.md` rendered by the site — single source of truth, no copy drift:

- Markdown compiled at build time (unified + shiki; twoslash hovers later via SITE-23's
  pipeline) into per-section HTML/components; the guide splits on `##` into sections with
  a sidebar; the reference renders whole with an anchor index.
- Dogfood: the doc content is an async load in `docScope` — so the docs pages themselves
  SSR + dehydrate through rati.
- Cross-links from guide sections to the matching pain page ("see it live").

**Tasks:** SITE-40 (markdown pipeline), SITE-41 (docs pages + sidebar/anchors).

### 5.5 About (`/about`)

Short: what rati is (boilerplate ¶), where it comes from (built alongside a real product;
extracted, not invented), the name story line, what it is not (from the guide), roadmap
pointer, credits. **Tasks:** SITE-42.

## 6. Technical shape

- **Workspace:** `website/` in this monorepo (workspace name `website`), consuming rati
  source via the `rati-dev` condition like the examples; `vp` scripts matching the repo
  (`website#dev`, `website#build`, `website#typecheck`).
- **SSR:** a Node server on the nazar.ch pattern (dev: Vite middleware; prod: static +
  rendered pages), simplified by the `rati/ssr` helpers as they land (CORE-1..3 in the
  tasks doc); title via the head mechanism (CORE-4) once absorbed. Deploy is out of scope
  this iteration; the build should keep the SSG door open (all pages resolvable without
  request-time data).
- **Styling:** plain CSS (custom properties + a small reset) unless the design work says
  otherwise — no framework CSS; the split-flap and panel are bespoke components anyway.
- **The site is a rati showcase, not a rati test:** where the site needs something rati
  lacks, that's a finding — file it against the research docs rather than working around
  it silently (this is how the nazar.ch list was built).

## 7. Open questions (for the next iteration)

- Domain/deploy target (ratijs.dev? rati.dev is likely taken) — irrelevant until release.
- Does the guide split into multiple .md files once the site's sidebar settles?
- Playground ambitions: an editable sandbox (Sandpack-style) is deliberately **out** of
  this iteration; revisit when the API stabilizes.
- Whether the waterfall timeline graduates into `rati/debug` (`dataTrace`).

---

## Appendix A — data-source catalog (oversized, by design)

A deliberately excessive menu for picking demo data. **Keyless** means usable with no
account; risk notes flag rate limits/fragility. Anything live should degrade to bundled
snapshots.

### Live, keyless APIs

| Source | Data | Why it's interesting for rati | Risk |
| --- | --- | --- | --- |
| transport.opendata.ch | Swiss station boards, connections | The board, on real rails; waterfall station→departures | rate-limited; CH-only |
| digitraffic.fi (Finnish Rail) | live trains, positions, delays — REST + MQTT/WebSocket | genuinely **live** trains → spectacular `Source` demo | Finland-only; MQTT plumbing |
| Open-Meteo | forecast, marine (waves/tides), air quality, historical | parallel loads (weather ∥ air ∥ marine); geo inputs | very generous, solid |
| USGS Earthquake GeoJSON | quakes, near-realtime, magnitude filters | polling `Source`; `not-available` for quiet regions; serious tone | solid |
| OpenSky Network | live aircraft positions by bbox | live map board; attach/detach on viewport change | anon quota is small |
| adsb.lol / airplanes.live | live aircraft (community ADS-B) | same as OpenSky, looser limits | community-run stability |
| aisstream.io | live ship positions (WebSocket) | ships instead of planes; harbor board | free key required |
| CityBikes (citybik.es) | bike-share stations + live availability, global | "any city" input; live counts; map | occasional stale feeds |
| NOAA Tides & Currents | tide predictions + water levels | tide clock source; pairs with marine weather | US stations only |
| NOAA SWPC | aurora / Kp index, space weather | a live "will I see the aurora" gauge | niche |
| Lichess API | live TV games (stream), puzzles, player data | **streamed chess moves as a `Source`** — mesmerizing | streams need care under SSR |
| Hacker News (Firebase) | stories, comments | dev-native; item→comments waterfall; pagination | id-per-item = many requests (good waterfall demo!) |
| GitHub REST (unauth) | repos, releases, contributors | dev-native; org→repos→releases waterfall | 60 req/h unauth — needs bundled fallback |
| npm registry + downloads API | package metadata, weekly downloads | *the* audience-native demo: rati's own package page | solid |
| bundlejs / bundlephobia | package size estimates | third parallel load for a package dashboard | flaky under load |
| Wikipedia / Wikidata | summaries, "on this day", geosearch | SSR-friendly prose; nearby-places by coords | solid |
| Overpass (OSM) | map features (cafés near a station…) | geo waterfall: station→coords→nearby | slow queries; be gentle |
| REST Countries | country facts | simple typed inputs demo; compare view | solid, static-ish |
| frankfurter.app | ECB FX rates, historical | currency converter; input-driven re-resolve; time series | solid |
| Nager.Date | public holidays, long weekends | "next long weekend" trip widget; date logic | solid |
| Art Institute of Chicago API | artworks + IIIF images, keyless | gorgeous SSR image pages; search + pagination | solid |
| Metropolitan Museum API | artworks + images | same, different collection | slower |
| Open Library | books, covers, authors | book→author→works waterfall; covers | patchy data (= honest `not-available` demos) |
| MusicBrainz | artists, releases | artist→releases waterfall | 1 req/s etiquette |
| TVMaze | shows, episodes, schedules | "what airs tonight" board | solid |
| iNaturalist | recent wildlife observations near a point | gentle, real, geo + seasonal; photo cards | solid |
| GBIF | biodiversity occurrences | serious-science flavor of the same | solid |
| Launch Library 2 | upcoming rocket launches | countdown = clock source + async load composed | 15 req/h anon |
| wheretheiss.at | ISS position now | trivial polling source; borderline gimmick | fine |
| Jolpica (ex-Ergast) F1 | seasons, results, standings | standings tables; season `:year` route param | community-run |
| UK Carbon Intensity API | grid carbon intensity, forecast | real-life relevance; regional `:postcode` param | UK-only |
| OpenAQ | air quality measurements worldwide | city compare view | key now required (free) |
| Sunrise-Sunset.org | sun times by coords | tiny composable load for other demos | solid |
| aviationweather.gov | METARs/TAFs | cryptic-but-real airport weather; parser demo | US-gov formats |

### Bundled / static datasets (deterministic, offline-safe)

| Source | Data | Use |
| --- | --- | --- |
| Swiss GTFS (opentransportdata.swiss) | full timetable dump | the Board's realistic schedule patterns |
| Any-city GTFS (transitfeeds/Mobility Database) | timetables worldwide | localize the Board elsewhere |
| Our World in Data CSVs | energy, health, population time series | charts with typed loaders; compare routes |
| Wikipedia dumps / curated extracts | prose + images | docs-adjacent SSR content |
| Met Office / MeteoSwiss open data files | historical weather | seasonal board backgrounds, charts |
| FOEN hydrological data (CH) | river temperatures/levels | charming local live-ish widget |
| Simulated SaaS ops dataset (hand-made) | deploys, incidents, metrics | the On-Call demos: fully controllable failures |
| Simulated logistics dataset (hand-made) | parcels, checkpoints, ETAs | package tracking — universally felt pain |
| Conference schedule (hand-made, realistic) | talks, rooms, speakers | schedule app: parallel loads, `:day` params |
| randomuser.me snapshots | realistic people | any demo needing humans without privacy questions |

### Example concepts, grouped by the rati feature they'd showcase

**Waterfalls & parallelism:** npm package dashboard (name→metadata→downloads ∥ size ∥
deps); GitHub release radar (org→repos→latest releases); HN story + comments; book →
author → other works (Open Library); station → departures ∥ weather ∥ nearby cafés.

**Live sources:** Lichess TV (streamed moves); Finnish rail live positions; delay-drift
board; tide clock; aurora gauge; bike-dock availability; launch countdown; the humble
clock.

**Typed routing & params:** F1 season explorer (`/f1/:year/:round`); museum gallery
(`/art/:artworkId` with SSR'd IIIF images); country compare (`/vs/:a/:b` — two inputs,
one scope); holiday planner (`/holidays/:country/:year`).

**Error slots & `not-available`:** Open Library's patchy records; USGS "no quakes here"
(happy `not-available`); unknown station; the network panel itself.

**SSR & dehydration:** Wikipedia "on this day" page; the museum page (image-heavy, HTML
matters); the docs pages themselves; the double-fetch demo.

**`hook()` / interop:** one demo adapting a react-query cache into a scope (transport
data through react-query, rendered rati-side) — the "you don't have to migrate" page.

**`keepCurrentRoute` / shallow nav:** two-station compare; two-city air quality; split
chessboard (two live games).

**`.provide()` / stores:** the Board's `StationContext` (departures + user's pinned
lines); a conference "my schedule" store over loaded talks.

Recommended shortlist if choosing today: the **Swiss board** (bundled) as the spine,
**npm package dashboard** as the dev-native waterfall page, **Lichess TV or Finnish
rail** as the live-source showstopper, **AIC museum** for the beautiful SSR page, and the
**simulated logistics tracker** as a future mutations demo.
