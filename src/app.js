import { filterPlaces, groupByCuisine, weightedPick } from './cuisine.js';
import { searchDemo, searchGoogle } from './places.js';

const $ = (sel) => document.querySelector(sel);
const KEY_STORAGE = 'choices.apiKey';
const CRITERIA_STORAGE = 'choices.criteria';
const DEMO_CENTER = { lat: 52.52, lng: 13.405 }; // Berlin, used when location is unavailable in demo mode

const state = { groups: [], duel: null, lastPickCuisine: null };

// ---------- storage (best effort: private windows may block it) ----------

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, value) {
  try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* ignore */ }
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

function renderResults(total) {
  const { groups } = state;
  $('#results-title').textContent = groups.length
    ? `${total} places · ${groups.length} cuisine${groups.length === 1 ? '' : 's'}`
    : 'Nothing matches right now';
  $('#results-sub').textContent = groups.length
    ? 'Tap a cuisine to see the places, or let us help you decide.'
    : 'Try a bigger radius, a lower minimum rating, or fewer required reviews.';
  $('#start-duel').disabled = groups.length < 2;
  $('#surprise').disabled = groups.length === 0;

  const grid = $('#cuisine-grid');
  grid.replaceChildren(...groups.map((g) => el('button', { type: 'button', class: 'cuisine', onclick: () => showDetail(g) }, [
    el('span', { class: 'emoji', 'aria-hidden': 'true' }, g.emoji),
    el('strong', {}, g.cuisine),
    el('small', {}, cuisineSummary(g)),
  ])));
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
  const pool = state.groups.length > 1 && state.lastPickCuisine
    ? state.groups.filter((g) => g !== state.lastPickCuisine)
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
    deep: f.deep.checked,
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
    const places = demo
      ? await searchDemo({ center, radius: criteria.radius })
      : await searchGoogle({ apiKey: apiKey(), center, radius: criteria.radius, deep: criteria.deep });

    const matches = filterPlaces(places, criteria);
    state.groups = groupByCuisine(matches);
    state.lastPickCuisine = null;
    setStatus('');
    renderResults(matches.length);
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
  $('#surprise').addEventListener('click', surprise);
  $('#pick-again').addEventListener('click', surprise);
  $('#pick-more').addEventListener('click', () => showDetail(state.lastPickCuisine));
  $('#duel-a').addEventListener('click', () => chooseInDuel('a'));
  $('#duel-b').addEventListener('click', () => chooseInDuel('b'));
}

init();
