import { filterPlaces, groupByCuisine, weightedPick } from './cuisine.js';
import { CROSS, TICKS, loopPath, strikePath, tallyStrokes } from './marks.js';
import { searchDemo, searchGoogle } from './places.js';
import { seedFrom } from './prng.js';
import { VETO, decideVote, tapBallot, vetoBallot } from './vote.js';

const $ = (sel) => document.querySelector(sel);
const KEY_STORAGE = 'choices.apiKey';
const CRITERIA_STORAGE = 'choices.criteria';
const DEMO_CENTER = { lat: 52.52, lng: 13.405 }; // Berlin, used when location is unavailable in demo mode

const CACHE_TTL_MS = 10 * 60 * 1000;
// Google gives 1,000 free Text Search (Enterprise) requests a month; 30 a day stays under that.
// This is per browser: it protects against our own overuse, not against someone copying the key.
const DAILY_REQUEST_LIMIT = 30;
const USAGE_STORAGE = 'choices.usage';

const state = { search: null, criteria: null, groups: [], duel: null, lastPickCuisine: null, vote: null };

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
  refreshPenMarks();
}

function setStatus(text, isError = false) {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

const fmtDistance = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const fmtPrice = (level) => (level == null ? '' : level === 0 ? 'Free' : '€'.repeat(level));
const plural = (n, word) => `${n} ${n === 1 ? word : word === 'person' ? 'people' : `${word}s`}`;

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

function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...[].concat(children));
  return node;
}

/** A printed icon from the sprite in index.html. */
const icon = (name, cls = '') => svg('svg', { class: `icon ${cls}`.trim(), 'aria-hidden': 'true' }, svg('use', { href: `#i-${name}` }));

// ---------- pen marks ----------
// Everything a person marks (ticks, loops, strikes, tallies) is drawn as a pen stroke.

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Clear space between text and the mark drawn on it, in ems: [sideways, up and down].
const PEN_CLEARANCE = { loop: [0.2, 0.1], strike: [0.2, 0] };

/**
 * An SVG of pen strokes. The first `skip` strokes are already on the paper;
 * the rest are drawn one after another.
 */
function penSvg(paths, { width, height, cls = '', animate = true, skip = 0, stagger = 110 }) {
  return svg('svg', { class: `pen ${cls}`.trim(), viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' },
    paths.map((d, i) => svg('path', {
      d,
      pathLength: 1,
      ...(animate && i >= skip && { class: 'draw', style: `animation-delay: ${(i - skip) * stagger}ms` }),
    })));
}

/** Draws a loop around, or a strike through, an element's text. The stroke is made to fit the text. */
function penMark(target, kind, animate = true) {
  target.querySelector(':scope > .pen-mark')?.remove();
  target.dataset.pen = kind; // remembered, so the mark can be redrawn when the layout changes
  const { width, height } = target.getBoundingClientRect();
  if (!width) return; // hidden for now: refreshPenMarks() draws it once it shows
  const style = getComputedStyle(target);
  const em = parseFloat(style.fontSize);
  const nib = parseFloat(style.getPropertyValue('--nib')) || 2.75;
  // A loop also needs room for its own thickness and for the overshoot that runs outside its start.
  const reach = kind === 'loop' ? nib * 2.75 : 0;
  const [roomX, roomY] = PEN_CLEARANCE[kind].map((clear) => clear * em + reach);
  const w = width + 2 * roomX;
  const h = height + 2 * roomY;
  const seed = seedFrom(target.textContent);
  const stroke = kind === 'loop' ? loopPath(w, h, seed, nib) : strikePath(w, h, seed);
  const mark = penSvg([stroke], { width: w, height: h, cls: 'pen-mark', animate });
  Object.assign(mark.style, { left: `${-roomX}px`, top: `${-roomY}px`, width: `${w}px`, height: `${h}px` });
  target.append(mark);
}

function clearPenMark(target) {
  target.querySelector(':scope > .pen-mark')?.remove();
  delete target.dataset.pen;
}

/** Redraws every loop and strike to fit its text again, e.g. after fonts load or the phone is turned. */
function refreshPenMarks() {
  document.querySelectorAll('[data-pen]').forEach((target) => penMark(target, target.dataset.pen, false));
}

/** Puts a cuisine in a big headline, sized so that its longest word fits the screen. */
function setHeadline(target, text) {
  target.textContent = text;
  target.parentElement.style.setProperty('--chars', Math.max(...text.split(/\s+/).map((word) => word.length)));
}

// ---------- results ----------

/** "7 places · ★ 4.5 avg · from 460 m": how many places a cuisine has, how good, how near. */
function cuisineDesc(g) {
  return [`${plural(g.count, 'place')} · `, icon('star', 'solid'), ` ${g.avgRating.toFixed(1)} avg · from ${fmtDistance(g.nearest)}`];
}

const rowNumber = (i) => el('span', { class: 'no', 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0'));

function placeRow(p) {
  const status = p.openNow === true ? el('span', { class: 'open' }, 'Open now')
    : p.openNow === false ? el('span', { class: 'closed' }, 'Closed') : el('span', {}, 'Hours unknown');
  const price = fmtPrice(p.priceLevel);
  return el('li', { class: 'place' }, [
    el('div', { class: 'place-head' }, [
      el('h3', {}, p.name),
      el('span', { class: 'leader', 'aria-hidden': 'true' }),
      el('span', { class: 'rating', 'aria-label': p.rating == null ? 'No rating' : `Rated ${p.rating.toFixed(1)}` },
        [p.rating?.toFixed(1) ?? '–', icon('star', 'solid')]),
    ]),
    el('p', { class: 'meta' }, [`${p.reviews.toLocaleString()} reviews · ${fmtDistance(p.distance)}${price ? ` · ${price}` : ''} · `, status]),
    p.address && p.address !== 'Demo address' ? el('p', { class: 'address' }, p.address) : null,
    el('a', { href: p.mapsUrl, target: '_blank', rel: 'noopener' }, ['Open in Google Maps', icon('arrow-out')]),
  ]);
}

function showResults() {
  const { search, criteria } = state;
  const matches = filterPlaces(search.places, criteria);
  state.groups = groupByCuisine(matches);
  const { groups } = state;

  $('#results-criteria').textContent = [
    criteria.openOnly ? 'Open now' : 'Open or closed',
    `within ${fmtDistance(criteria.radius)}`,
    `rated ${criteria.minRating.toFixed(1)}+`,
    criteria.minReviews > 0 && `${criteria.minReviews.toLocaleString()}+ reviews`,
  ].filter(Boolean).join(' · ');
  $('#results-title').textContent = groups.length
    ? `${plural(matches.length, 'place')}, ${plural(groups.length, 'cuisine')}`
    : 'Nothing matches right now';
  $('#results-sub').textContent = groups.length
    ? 'Tap a cuisine to see its places, or let the table decide.'
    : 'Try a bigger radius, a lower minimum rating, or fewer required reviews.';
  $('#results-actions').hidden = groups.length === 0;
  $('#start-vote').disabled = groups.length < 2;
  $('#start-duel').disabled = groups.length < 2;

  $('#cuisine-list').replaceChildren(...groups.map((g, i) => el('li', {},
    el('button', { type: 'button', class: 'row', onclick: () => showDetail(g) }, [
      rowNumber(i),
      el('span', { class: 'item' }, [el('span', { class: 'name' }, g.cuisine), el('span', { class: 'desc' }, cuisineDesc(g))]),
      icon('arrow-right'),
    ]))));
  $('#cuisine-list').hidden = groups.length === 0;

  $('#load-more').hidden = !search.nextPageToken;
  const left = Math.max(0, DAILY_REQUEST_LIMIT - requestsUsedToday());
  $('#requests-left').hidden = search.demo;
  $('#requests-left').textContent = `${left} of ${DAILY_REQUEST_LIMIT} Google requests left today.${search.nextPageToken ? ' Showing more uses one.' : ''}`;
  show('view-results');
}

function showDetail(group) {
  $('#detail-count').textContent = `${plural(group.count, 'place')} · best first`;
  $('#detail-title').textContent = group.cuisine;
  $('#place-list').replaceChildren(...group.places.map(placeRow));
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
    btn.replaceChildren(el('span', { class: 'name' }, g.cuisine), el('span', { class: 'desc' }, cuisineDesc(g)));
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
  // Best few places in the cuisine are equally good candidates; pick among them.
  const place = weightedPick(group.places.slice(0, 3), (_, i) => 3 - i);
  setHeadline($('#pick-cuisine'), group.cuisine);
  $('#pick-place').replaceChildren(placeRow(place));
  show('view-pick');
  penMark($('#pick-cuisine'), 'loop');
}

function surprise() {
  // Groups are rebuilt when more places load, so compare by name.
  const pool = state.groups.length > 1 && state.lastPickCuisine
    ? state.groups.filter((g) => g.cuisine !== state.lastPickCuisine.cuisine)
    : state.groups;
  showPick(weightedPick(pool, (g) => g.count * g.avgScore));
}

// ---------- deciding: group vote (pass the phone around) ----------

// What a row's marks mean, for screen readers.
const VOTE_STATE = { 0: '', 1: 'Happy with it', 2: 'Really want it, counts double', [VETO]: 'Vetoed' };

function startVote() {
  // Cuisine names are fixed for the whole vote, so loading more places later can't disturb it.
  state.vote = { cuisines: state.groups.map((g) => g.cuisine), ballots: [], current: {}, vetoMode: false };
  renderBallot();
  show('view-vote');
}

/** A clean ballot for the next voter. `saved` tells them the previous vote went in. */
function renderBallot({ saved = false } = {}) {
  const groups = state.vote.cuisines.map((name) => state.groups.find((g) => g.cuisine === name)).filter(Boolean);
  $('#vote-list').replaceChildren(...groups.map((g, i) => el('li', {}, el('button', {
    type: 'button', class: 'row', 'data-cuisine': g.cuisine, 'data-points': 0, 'aria-pressed': 'false',
    onclick: () => tapVoteRow(g.cuisine),
  }, [
    rowNumber(i),
    el('span', { class: 'item' }, [
      el('span', { class: 'name' }, el('span', { class: 'circled' }, g.cuisine)),
      el('span', { class: 'desc' }, plural(g.count, 'place')),
      el('span', { class: 'sr-only vote-state' }),
    ]),
    el('span', { class: 'tickbox', 'aria-hidden': 'true' }),
  ]))));
  syncBallot({ saved });
}

function tapVoteRow(cuisine) {
  const { vote } = state;
  vote.current = vote.vetoMode ? vetoBallot(vote.current, cuisine) : tapBallot(vote.current, cuisine);
  vote.vetoMode = false;
  syncBallot();
}

/**
 * Brings the ballot in line with the current voter's picks. Only rows whose marks
 * changed are redrawn, so only new strokes animate.
 */
function syncBallot({ saved = false } = {}) {
  const { ballots, current, vetoMode } = state.vote;
  const voter = ballots.length + 1;
  const picked = Object.keys(current).length > 0;
  const vetoedCuisine = Object.keys(current).find((c) => current[c] === VETO);

  const count = $('#vote-count');
  count.textContent = saved ? `Saved. Pass the phone to voter ${voter}.`
    : ballots.length ? `Group vote · ${plural(ballots.length, 'person')} voted so far` : 'Group vote';
  count.classList.toggle('saved', saved);
  $('#vote-title').textContent = `Voter ${voter},`;
  $('#vote-next').disabled = !picked;
  $('#vote-finish').disabled = !picked && ballots.length === 0;

  $('#vote-veto').setAttribute('aria-pressed', String(vetoMode));
  $('#vote-veto-label').textContent = vetoMode ? 'Now tap the cuisine to rule out'
    : vetoedCuisine ? `Vetoed: ${vetoedCuisine} (tap to change)` : 'Veto one cuisine';
  $('#vote-list').classList.toggle('veto-mode', vetoMode);

  for (const row of $('#vote-list').querySelectorAll('.row')) {
    const points = current[row.dataset.cuisine] ?? 0;
    const before = Number(row.dataset.points);
    if (points !== before) markRow(row, points, before);
  }
}

/** Marks one ballot row: ticks in its box (a cross for a veto), a loop round a favourite, a strike through a veto. */
function markRow(row, points, before) {
  row.dataset.points = points;
  row.setAttribute('aria-pressed', String(points !== 0));
  row.querySelector('.vote-state').textContent = VOTE_STATE[points];

  const strokes = points === VETO ? CROSS : TICKS.slice(0, points);
  const kept = points > 0 && before > 0 ? Math.min(points, before) : 0; // ticks already there aren't drawn again
  row.querySelector('.tickbox').replaceChildren(...(strokes.length ? [penSvg(strokes, { width: 40, height: 40, skip: kept })] : []));

  const name = row.querySelector('.circled');
  if (points === 2) penMark(name, 'loop');
  else if (points === VETO) penMark(name, 'strike');
  else clearPenMark(name);
}

/** Stores the current person's picks and clears the screen for the next person. */
function submitBallot() {
  const { vote } = state;
  if (!Object.keys(vote.current).length) return;
  vote.ballots.push(vote.current);
  vote.current = {};
  vote.vetoMode = false;
}

function nextVoter() {
  submitBallot();
  renderBallot({ saved: true });
  window.scrollTo(0, 0);
  // A fresh sheet slides in, so it's obvious the screen now belongs to the next person.
  if (!reducedMotion.matches) {
    $('#view-vote').animate?.(
      [{ opacity: 0, transform: 'translateX(28px)' }, { opacity: 1, transform: 'none' }],
      { duration: 280, easing: 'cubic-bezier(.2, .7, .2, 1)' },
    );
  }
}

/** Points as tally strokes, the way you'd keep score on paper. Past 25 a figure is easier to read. */
function tallyMarks(points, cuisine) {
  if (points > 25) return el('span', { class: 'figure' }, String(points));
  const { width, height, paths } = tallyStrokes(points, seedFrom(cuisine));
  const marks = penSvg(paths, { width, height, cls: 'tally', stagger: 70 });
  Object.assign(marks.style, { width: `${width}px`, height: `${height}px` });
  return marks;
}

function countRow(cuisine, marks, note, cls) {
  return el('li', { class: cls }, [
    el('span', { class: 'name' }, el('span', { class: 'circled' }, cuisine)),
    el('span', { class: 'leader', 'aria-hidden': 'true' }),
    el('span', { class: 'marks', 'aria-hidden': 'true' }, marks),
    el('span', { class: 'note' }, note),
  ]);
}

function finishVote() {
  submitBallot();
  const { ballots } = state.vote;
  const { ranking, vetoed, winner, tied } = decideVote(ballots);
  const group = state.groups.find((g) => g.cuisine === winner);
  const headline = $('#vote-winner');

  $('#vote-result-eyebrow').textContent = `${plural(ballots.length, 'person')} voted${group ? '. The winner is' : ''}`;
  setHeadline(headline, group ? group.cuisine : 'No winner');
  headline.parentElement.classList.toggle('plain', !group);
  const remark = !group ? 'Every cuisine that got votes was vetoed. Try another round.'
    : tied.length ? `${tied.slice(0, -1).join(', ')} and ${tied.at(-1)} tied on ${plural(ranking[0].points, 'point')}, so one was picked at random.`
      : '';
  $('#vote-tie').textContent = remark;
  $('#vote-tie').hidden = !remark;
  // The winner heads the count, even when a tie was broken in favour of a name further down.
  const order = [...ranking].sort((x, y) => (y.cuisine === winner) - (x.cuisine === winner));
  $('#vote-tally').replaceChildren(
    ...order.map((r) => countRow(r.cuisine, tallyMarks(r.points, r.cuisine),
      `${r.cuisine === winner ? 'Winner · ' : ''}${plural(r.points, 'point')} · ${plural(r.voters, 'person')}`,
      r.cuisine === winner ? 'winner' : '')),
    ...vetoed.map((v) => countRow(v.cuisine, penSvg(CROSS, { width: 40, height: 40 }),
      `Vetoed${v.points ? ` · had ${plural(v.points, 'point')}` : ''}`, 'vetoed')),
  );
  $('#vote-places-title').hidden = !group;
  $('#vote-places').hidden = !group;
  if (group) {
    state.lastPickCuisine = group;
    $('#vote-places-title').textContent = `${group.cuisine} places, best first`;
    $('#vote-places').replaceChildren(...group.places.map(placeRow));
  }
  show('view-vote-result');
  // Loops and strikes are fitted to their text, so they go on once the view is showing.
  if (group) penMark(headline, 'loop');
  else clearPenMark(headline);
  $('#vote-tally').querySelectorAll('.vetoed .circled').forEach((name) => penMark(name, 'strike'));
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

// ---------- installable app ----------

function initInstall() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered', err));
  }
  // Chrome and Edge (Android, desktop) fire this when the app can be installed.
  // Safari on iPhone has no such event: there it's Share -> Add to Home Screen.
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    $('#install').hidden = false;
  });
  $('#install').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('#install').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#install').hidden = true; });
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
    $('#rating-out').textContent = Number(f.minRating.value).toFixed(1);
    // How far along each slider is, for the inked part of its track.
    for (const range of [f.radius, f.minRating]) {
      range.style.setProperty('--p', (range.value - range.min) / (range.max - range.min));
    }
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
  $('#start-vote').addEventListener('click', startVote);
  $('#vote-next').addEventListener('click', nextVoter);
  $('#vote-veto').addEventListener('click', () => { state.vote.vetoMode = !state.vote.vetoMode; syncBallot(); });
  $('#vote-finish').addEventListener('click', finishVote);
  $('#vote-cancel').addEventListener('click', () => show('view-results'));
  $('#vote-again').addEventListener('click', startVote);
  $('#vote-result-back').addEventListener('click', () => show('view-results'));
  $('#load-more').addEventListener('click', loadMore);
  $('#surprise').addEventListener('click', surprise);
  $('#pick-again').addEventListener('click', surprise);
  $('#pick-more').addEventListener('click', () => showDetail(state.lastPickCuisine));
  $('#duel-a').addEventListener('click', () => chooseInDuel('a'));
  $('#duel-b').addEventListener('click', () => chooseInDuel('b'));
  initPenMarks();
}

function initPenMarks() {
  // Pen marks that are part of the page itself: the key on the ballot, the veto button, the tick in a checkbox.
  const marks = { tick: TICKS.slice(0, 1), ticks: TICKS, cross: CROSS };
  for (const holder of document.querySelectorAll('[data-mark]')) {
    holder.prepend(penSvg(marks[holder.dataset.mark], { width: 40, height: 40, animate: false }));
  }

  // The loop in the headline is fitted to the word, so it waits for the real typeface.
  (document.fonts?.ready ?? Promise.resolve()).then(() => penMark($('#hero-word'), 'loop'));

  // Loops and strikes are sized to their text: refit them when the width changes (turning the phone).
  let width = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === width) return; // only the height changed, e.g. the address bar hiding
    width = window.innerWidth;
    refreshPenMarks();
  });
}

init();
initInstall();
