# Choices

A static web app (hosted on GitHub Pages) that helps you decide where to eat:

1. Gets your location from the browser.
2. Finds restaurants nearby with the Google Places API (New).
3. Keeps only places that are **open now** and meet your **minimum rating and review count**.
4. Groups them **by cuisine**.
5. Helps you choose: browse cuisines, play **"this or that"** between cuisines, or tap **Surprise me**.

Without an API key it runs on demo data, so you can try it right away (`index.html?demo` forces demo mode).

## Run locally

```sh
npm start   # serves the folder on http://localhost:8000 (needs Python 3)
npm test    # unit tests for the filtering and grouping logic (Node 22+)
```

Geolocation only works on `https://` or `http://localhost`.

## Hook up Google Maps

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project with billing enabled.
2. Enable **Places API (New)**.
3. Create an API key and restrict it:
   - Application restriction: **Websites** → `https://<your-user>.github.io/*` (plus `http://localhost:8000/*` for development).
   - API restriction: only **Places API (New)**.
   - Cap usage so you stay in the free allowance: open **Google Maps Platform → Quotas** (or **IAM & Admin → Quotas & System Limits**), pick **Places API (New)**, and set the per-minute *SearchText* limit low (for example **5**). Places API (New) has no per-day limit, so this only slows down misuse; also set a billing budget alert.
4. **Don't commit the key.** Add it as a repository secret named `GOOGLE_MAPS_API_KEY` (**Settings → Secrets and variables → Actions**). The deploy workflow writes it into the published `config.js` only, and CI fails if a key is ever committed. For local development, paste the key in the app under *Google Maps API key* (stored only in that browser).

Visitors of the live site can still see a browser key; the restrictions above are what limit its use.

**Cost:** each scan makes 1 Text Search request (20 places). *Show more places* fetches the next 20, up to 60, at 1 request each. The app asks for rating and opening hours, so Google bills these requests at the Places "Enterprise" SKU, which currently includes 1,000 free requests per month (terms can differ for EEA billing addresses). Results are reused for 10 minutes for the same spot, radius, rating step and open-now setting, so going back or changing the review filter doesn't make a new request. The app also stops itself after 30 Google requests per day per browser (`DAILY_REQUEST_LIMIT` in `src/app.js`); that only limits your own use, so the Google-side quota is still the real safety net. See Google's pricing page for current prices.

## Deploy to GitHub Pages

The workflow in `.github/workflows/pages.yml` runs the tests and deploys on every push to `main`.
Turn it on once under **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## How it's built

| Element | Where | What it does |
|---|---|---|
| Page and views | `index.html`, `styles.css` | Mobile-first single page: criteria, cuisine grid, cuisine detail, duel, pick. Light and dark theme. |
| Config | `config.js` | Public runtime config (the restricted API key). |
| Places provider | `src/places.js` | Calls Places API (New) Text Search over REST. Google filters by open-now and minimum rating, and pages through up to 60 results. Leaves out non-food places (hotels, landmarks) and normalizes results. Also contains the demo-data provider. |
| Cuisine logic | `src/cuisine.js` | Maps Google place types to cuisines, filters by your criteria, ranks places by review-weighted rating, groups and sorts cuisines, makes weighted random picks. Pure functions, unit-tested. |
| App controller | `src/app.js` | Geolocation, scan flow, rendering, the "this or that" duel and Surprise me. Saves your criteria in localStorage. |
| Tests | `tests/` | `node:test` unit tests for the cuisine logic. |
| CI/CD | `.github/workflows/pages.yml` | Runs the tests, then publishes to GitHub Pages. |

### Possible next steps

- Enter an address by hand when location is denied (Places Autocomplete or Geocoding).
- A map view of results (would need the Maps JavaScript API again).
- More filters: price level, walking time, "open for at least another hour", dietary options.
- Cache results for a few minutes to save API calls.
- Group decisions: share a link so friends can vote on cuisines.
- Installable PWA (manifest and service worker).
- A small serverless proxy (for example a Cloudflare Worker) if you'd rather keep the key off the client.
