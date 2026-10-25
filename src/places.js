// Data providers. Both return one page of results:
// { places: [{ id, name, cuisine, rating, reviews, priceLevel (0-4|null), lat, lng, address, mapsUrl, openNow (bool|undefined), distance }],
//   nextPageToken: string|null }
import { cuisineOf, distanceMeters, isFoodPlace, isOpenAt } from './cuisine.js';

// ---------- Google Places API (New): Text Search over REST ----------
//
// Text Search (unlike Nearby Search) filters by "open now" and minimum rating on
// Google's side and pages through up to 60 results, 20 per request.

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'id', 'displayName', 'primaryType', 'primaryTypeDisplayName', 'types', 'rating', 'userRatingCount',
  'priceLevel', 'location', 'formattedAddress', 'googleMapsUri', 'currentOpeningHours.openNow',
  'regularOpeningHours.periods', 'utcOffsetMinutes', 'businessStatus',
].map((f) => `places.${f}`).concat('nextPageToken').join(',');

const PRICE_LEVELS = {
  PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/** Text Search only takes a rectangle, so search the box around the circle and trim to the radius afterwards. */
function boundsAround({ lat, lng }, radius) {
  const dLat = radius / 111320;
  const dLng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  return { low: { latitude: lat - dLat, longitude: lng - dLng }, high: { latitude: lat + dLat, longitude: lng + dLng } };
}

function googleError(status, error) {
  if (status === 403) return 'Google rejected the API key. Check that the Places API (New) is enabled and this site is an allowed website for the key.';
  if (status === 429) return 'Google\'s request limit for this key was reached. Try again later.';
  return `Google Places error: ${error?.message ?? `HTTP ${status}`}`;
}

/** One billable request. Pass the previous result's nextPageToken (with the same other params) for the next page. */
export async function searchGoogle({ apiKey, center, radius, minRating = 0, openOnly = true, pageToken }) {
  const body = {
    textQuery: 'restaurant',
    includedType: 'restaurant',
    strictTypeFiltering: true,
    pageSize: 20,
    locationRestriction: { rectangle: boundsAround(center, radius) },
    // Google rounds minRating *up* to the next 0.5, so round down here and filter exactly afterwards.
    minRating: Math.floor(minRating * 2) / 2,
    ...(openOnly && { openNow: true }),
    ...(pageToken && { pageToken }),
  };
  let res;
  try {
    res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach Google. Check your network connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(googleError(res.status, data.error));

  const places = (data.places ?? [])
    .filter((p) => (!p.businessStatus || p.businessStatus === 'OPERATIONAL') && isFoodPlace(p))
    .map((p) => normalizeGooglePlace(p, center))
    .filter((p) => p.distance <= radius); // drop the corners of the search box
  return { places, nextPageToken: data.nextPageToken ?? null };
}

function normalizeGooglePlace(place, center) {
  const lat = place.location.latitude;
  const lng = place.location.longitude;
  return {
    id: place.id,
    name: place.displayName?.text ?? 'Unnamed place',
    cuisine: cuisineOf({ ...place, primaryTypeDisplayName: place.primaryTypeDisplayName?.text }),
    rating: place.rating ?? null,
    reviews: place.userRatingCount ?? 0,
    priceLevel: PRICE_LEVELS[place.priceLevel] ?? null,
    lat,
    lng,
    address: place.formattedAddress ?? '',
    mapsUrl: place.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    // Google's own answer includes holiday hours; the weekly periods are a fallback.
    openNow: place.currentOpeningHours?.openNow ?? isOpenAt(place.regularOpeningHours?.periods, place.utcOffsetMinutes),
    distance: distanceMeters(center, { lat, lng }),
  };
}

// ---------- Demo data (no API key needed) ----------

const DEMO_NAMES = {
  italian_restaurant: ['Trattoria Nonna', 'Osteria del Ponte', 'La Dolce Vita'],
  pizza_restaurant: ['Forno Rosso', 'Slice Society', 'Pizzeria Napoli'],
  japanese_restaurant: ['Izakaya Hana', 'Kyoto Kitchen'],
  sushi_restaurant: ['Sushi Ren', 'Maki Bar', 'Ocean Roll'],
  ramen_restaurant: ['Ramen Ichiban', 'Tonkotsu House'],
  thai_restaurant: ['Bangkok Street', 'Lemongrass', 'Siam Garden'],
  vietnamese_restaurant: ['Pho Saigon', 'Banh Mi Corner'],
  indian_restaurant: ['Tandoori Nights', 'Masala House', 'Spice Route'],
  mexican_restaurant: ['Taqueria El Sol', 'Casa Verde', 'Burrito Loco'],
  hamburger_restaurant: ['Smash Bros Burgers', 'Grill & Bun'],
  greek_restaurant: ['Mykonos Taverna', 'Olive & Feta'],
  chinese_restaurant: ['Golden Dragon', 'Dumpling Lab', 'Sichuan House'],
  korean_restaurant: ['Seoul BBQ', 'Bibimbap & Co'],
  vegan_restaurant: ['Green Bowl', 'Plant Power'],
  turkish_restaurant: ['Istanbul Grill'],
  french_restaurant: ['Bistro Lumière'],
  steak_house: ['The Butcher Block'],
};

// Small deterministic PRNG so demo results are stable for a given location.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function searchDemo({ center, radius, pageToken }) {
  const rand = mulberry32(Math.round(center.lat * 1000) * 31 + Math.round(center.lng * 1000));
  const places = [];
  for (const [type, names] of Object.entries(DEMO_NAMES)) {
    names.forEach((name, i) => {
      // Uniformly random point inside the radius.
      const r = radius * Math.sqrt(rand());
      const theta = rand() * 2 * Math.PI;
      const lat = center.lat + (r * Math.cos(theta)) / 111320;
      const lng = center.lng + (r * Math.sin(theta)) / (111320 * Math.cos((center.lat * Math.PI) / 180));
      const rating = Math.round((3.4 + rand() * 1.6) * 10) / 10;
      places.push({
        id: `demo-${type}-${i}`,
        name,
        cuisine: cuisineOf({ primaryType: type, types: [type, 'restaurant'] }),
        rating,
        reviews: Math.round(10 + rand() ** 2 * 2500),
        priceLevel: 1 + Math.floor(rand() * 3),
        lat,
        lng,
        address: 'Demo address',
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`,
        openNow: rand() > 0.2 ? true : rand() > 0.5 ? false : undefined,
        distance: distanceMeters(center, { lat, lng }),
      });
    });
  }
  await new Promise((r) => setTimeout(r, 300)); // feel like a network call
  const start = Number(pageToken ?? 0);
  const end = start + 20;
  return { places: places.slice(start, end), nextPageToken: end < places.length ? String(end) : null };
}
