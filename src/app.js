import { filterPlaces, groupByCuisine, weightedPick } from './cuisine.js';
import { searchDemo, searchGoogle } from './places.js';

const $ = (sel) => document.querySelector(sel);
const KEY_STORAGE = 'choices.apiKey';
const CRITERIA_STORAGE = 'choices.criteria';
const DEMO_CENTER = { lat: 52.52, lng: 13.405 }; // Berlin, used when location is unavailable in demo mode

const CACHE_TTL_MS = 10 * 60 * 1000;
// Google gives 1,000 free Text Search (Enterprise) requests a month; 30 a day stays under that.
// This is per browser: it protects against our own overuse, not against someone copying the key.
const DAILY_REQUEST_LIMIT = 30;
const USAGE_STORAGE = 'choices.usage';

const state = { search: null, criteria: null, groups: [], duel: null, lastPickCuisine: null };

// Recent searches, kept in memory only, so scanning again from roughly the same spot,
// or changing only the review filter, doesn't cost another API request.
const searches = new Map();

function searchKey({ center, radius, minRating, openOnly }, demo) {
  // 3 decimals is ~100 m, so small GPS jitter still hits the cache. Google filters
  // rating in 0.5 steps, so 4.2 and 4.4 share a search; the exact cut is applied locally.
  return [demo ? 'demo' : 'google', center.lat.toFixed(3), center.lng.toFixed(3), radius,
    Math.floor(minRating * 2) / 2, openOnly].join('|');
}

function spendRequest() {
  if (requestsUsedToday() >= DAILY_REQUEST_LIMIT) {
    throw new Error(`Daily limit reached (${DAILY_REQUEST_LIMIT} Google requests) to stay within the free allowance. Try again tomorrow.`);
  }
  // Counted before the call: a request that fails halfway may still be billed.
  recordRequests(1);
}

function fetchPage(params, demo, pageToken) {
  if (demo) return searchDemo({ ...params, pageToken });
  spendRequest();
  return searchGoogle({ ...params, apiKey: apiKey(), pageToken });
}

async function startSearch(params, demo) {
  const key = searchKey(params, demo);
  const hit = searches.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
  const page = await fetchPage(params, demo);
  const search = { at: Date.now(), params, demo, places: page.places, nextPageToken: page.nextPageToken };
  searches.set(key, search);
  return search;
}

/** Fetches the next page of the current search (one more request) and adds it to the results. */
async function loadMore() {
  const { search } = state;
  const button = $('#load-more');
  button.disabled = true;
  $('#more-status').textContent = '';
  try {
    const page = await fetchPage(search.params, search.demo, search.nextPageToken);
    const seen = new Set(search.places.map((p) => p.id));
    search.places.push(...page.places.filter((p) => !seen.has(p.id)));
    search.nextPageToken = page.nextPageToken;
    showResults();
  } catch (err) {
    console.error(err);
    $('#more-status').textContent = err.message || 'Something went wrong.';
  } finally {
    button.disabled = false;
  }
}

// ---------- storage (best effort: private windows may block it) ----------

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, value) {
  try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* ignore */ }
}

// ---------- daily request guard ----------

// Mirrors storage so the guard still works for this page when localStorage is blocked.
let usageFallback = { day: '', count: 0 };

const today = () => new Date().toLocaleDateString('sv'); // local date as YYYY-MM-DD

function readUsage() {
  let usage = usageFallback;
  try {
    usage = JSON.parse(load(USAGE_STORAGE)) ?? usageFallback;
  } catch { /* ignore bad saved data */ }
  return usage.day === today() ? usage : { day: today(), count: 0 };
}

function requestsUsedToday() {
  return Math.max(readUsage().count, usageFallback.day === today() ? usageFallback.count : 0);
}

function recordRequests(n) {
  usageFallback = { day: today(), count: requestsUsedToday() + n };
  save(USAGE_STORAGE, JSON.stringify(usageFallback));
}

function apiKey() {
  const form = $('#criteria');
  return form.apiKey.value.trim() || window.CHOICES_CONFIG?.googleMapsApiKey || '';
}

function isDemo() {
  return new URLSearchParams(location.search).has('demo') || !apiKey();
}

// ---------- views ----------

function show(id) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== id; });
  window.scrollTo(0, 0);
}

function setStatus(text, isError = false) {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

const fmtDistance = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const fmtPrice = (level) => (level == null ? '' : level === 0 ? 'Free' : '€'.repeat(level));

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...[].concat(children).filter((c) => c != null && c !== false));
  return node;
}

function cuisineSummary(g) {
  return `${g.count} place${g.count === 1 ? '' : 's'} · ★ ${g.avgRating.toFixed(1)} avg · ${fmtDistance(g.nearest)} nearest`;
}

function placeCard(p) {
  const status = p.openNow === true ? el('span', { class: 'open' }, 'Open now')
    : p.openNow === false ? el('span', { class: 'closed' }, 'Closed') : el('span', {}, 'Hours unknown');
  return el('li', { class: 'place' }, [
    el('h3', {}, p.name),
    el('div', { class: 'meta' }, [
      el('span', { class: 'rating' }, `★ ${p.rating?.toFixed(1) ?? '–'}`),
      el('span', {}, `${p.reviews.toLocaleString()} reviews`),
      el('span', {}, fmtDistance(p.distance)),
      fmtPrice(p.priceLevel) && el('span', {}, fmtPrice(p.priceLevel)),
      status,
    ]),
    p.address && p.address !== 'Demo address' ? el('div', { class: 'meta' }, p.address) : null,
    el('a', { href: p.mapsUrl, target: '_blank', rel: 'noopener' }, 'Open in Google Maps →'),
  ]);
}

function showResults() {
  const { search, criteria } = state;
  const matches = filterPlaces(search.places, criteria);
  state.groups = groupByCuisine(matches);
  const { groups } = state;

  $('#results-title').textContent = groups.length
    ? `${matches.length} places · ${groups.length} cuisine${groups.length === 1 ? '' : 's'}`
    : 'Nothing matches right now';
  let sub = groups.length
    ? 'Tap a cuisine to see the places, or let us help you decide.'
    : 'Try a bigger radius, a lower minimum rating, or fewer required reviews.';
  if (!search.demo) {
    const left = Math.max(0, DAILY_REQUEST_LIMIT - requestsUsedToday());
    sub += ` ${left} of ${DAILY_REQUEST_LIMIT} Google requests left today.`;
  }
  $('#results-sub').textContent = sub;
  $('#start-duel').disabled = groups.length < 2;
  $('#surprise').disabled = groups.length === 0;

  const grid = $('#cuisine-grid');
  grid.replaceChildren(...groups.map((g) => el('button', { type: 'button', class: 'cuisine', onclick: () => showDetail(g) }, [
    el('span', { class: 'emoji', 'aria-hidden': 'true' }, g.emoji),
    el('strong', {}, g.cuisine),
    el('small', {}, cuisineSummary(g)),
  ])));
  $('#load-more').hidden = !search.nextPageToken;
  $('#load-more').textContent = search.demo ? 'Show more places' : 'Show more places (uses 1 request)';
  show('view-results');
}

function showDetail(group) {
  $('#detail-title').textContent = `${group.emoji} ${group.cuisine}`;
  $('#place-list').replaceChildren(...group.places.map(placeCard));
  show('view-detail');
}

// ---------- deciding: duel (winner stays on) ----------

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startDuel() {
  const queue = shuffle(state.groups);
  state.duel = { champion: queue.shift(), challenger: queue.shift(), queue, round: 1, rounds: state.groups.length - 1 };
  renderDuel();
}

function renderDuel() {
  const { champion, challenger, round, rounds } = state.duel;
  $('#duel-progress').textContent = `Round ${round} of ${rounds}`;
  for (const [btn, g] of [[$('#duel-a'), champion], [$('#duel-b'), challenger]]) {
    btn.replaceChildren(
      el('span', { class: 'emoji', 'aria-hidden': 'true' }, g.emoji),
      el('strong', {}, g.cuisine),
      el('small', {}, cuisineSummary(g)),
    );
  }
  show('view-duel');
}

function chooseInDuel(side) {
  const d = state.duel;
  d.champion = side === 'a' ? d.champion : d.challenger;
  if (!d.queue.length) return showPick(d.champion);
  d.challenger = d.queue.shift();
  d.round++;
  renderDuel();
}

// ---------- deciding: the pick ----------

function showPick(group) {
  state.lastPickCuisine = group;
  $('#pick-cuisine').textContent = `${group.emoji} ${group.cuisine}`;
  // Best few places in the cuisine are equally good candidates; pick among them.
  const place = weightedPick(group.places.slice(0, 3), (_, i) => 3 - i);
  $('#pick-place').replaceChildren(el('ol', { class: 'places' }, placeCard(place)));
  show('view-pick');
}

function surprise() {
  // Groups are rebuilt when more places load, so compare by name.
  const pool = state.groups.length > 1 && state.lastPickCuisine
    ? state.groups.filter((g) => g.cuisine !== state.lastPickCuisine.cuisine)
    : state.groups;
  showPick(weightedPick(pool, (g) => g.count * g.avgScore));
}

// ---------- scanning ----------

function readCriteria() {
  const f = $('#criteria');
  return {
    radius: Number(f.radius.value),
    minRating: Number(f.minRating.value),
    minReviews: Number(f.minReviews.value) || 0,
    openOnly: f.openOnly.checked,
  };
}

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Your browser does not support location.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED
        ? 'Location permission was denied. Allow it in your browser settings to find places near you.'
        : 'Could not determine your location. Try again.')),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

async function scan(event) {
  event.preventDefault();
  const criteria = readCriteria();
  save(CRITERIA_STORAGE, JSON.stringify(criteria));
  save(KEY_STORAGE, $('#criteria').apiKey.value.trim());
  const demo = isDemo();
  $('#mode-badge').hidden = !demo;

  const button = $('#scan');
  button.disabled = true;
  try {
    setStatus('Finding your location…');
    let center;
    try {
      center = await getLocation();
    } catch (err) {
      if (!demo) throw err;
      center = DEMO_CENTER;
    }

    setStatus('Looking for restaurants…');
    const { radius, minRating, openOnly } = criteria;
    state.search = await startSearch({ center, radius, minRating, openOnly }, demo);
    state.criteria = criteria;
    state.lastPickCuisine = null;
    $('#more-status').textContent = '';
    setStatus('');
    showResults();
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Something went wrong.', true);
  } finally {
    button.disabled = false;
  }
}

// ---------- wiring ----------

function init() {
  const f = $('#criteria');
  try {
    const saved = JSON.parse(load(CRITERIA_STORAGE) || '{}');
    for (const [k, v] of Object.entries(saved)) {
      if (!f[k]) continue;
      if (f[k].type === 'checkbox') f[k].checked = v;
      else f[k].value = v;
    }
  } catch { /* ignore bad saved data */ }
  f.apiKey.value = load(KEY_STORAGE) || '';

  const syncOutputs = () => {
    $('#radius-out').textContent = fmtDistance(Number(f.radius.value));
    $('#rating-out').textContent = `${Number(f.minRating.value).toFixed(1)} ★`;
  };
  f.addEventListener('input', syncOutputs);
  syncOutputs();

  f.addEventListener('submit', scan);
  $('#home').addEventListener('click', () => show('view-start'));
  $('#back-start').addEventListener('click', () => show('view-start'));
  $('#back-results').addEventListener('click', () => show('view-results'));
  $('#duel-cancel').addEventListener('click', () => show('view-results'));
  $('#pick-back').addEventListener('click', () => show('view-results'));
  $('#start-duel').addEventListener('click', startDuel);
  $('#load-more').addEventListener('click', loadMore);
  $('#surprise').addEventListener('click', surprise);
  $('#pick-again').addEventListener('click', surprise);
  $('#pick-more').addEventListener('click', () => showDetail(state.lastPickCuisine));
  $('#duel-a').addEventListener('click', () => chooseInDuel('a'));
  $('#duel-b').addEventListener('click', () => chooseInDuel('b'));
}

init();
