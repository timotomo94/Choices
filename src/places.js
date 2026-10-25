// Data providers. Both return a list of normalized places:
// { id, name, cuisine, rating, reviews, priceLevel (0-4|null), lat, lng, address, mapsUrl, openNow (bool|undefined), distance }
import { CUISINE_TYPES, cuisineOf, distanceMeters } from './cuisine.js';

// ---------- Google Places (New) via the Maps JavaScript API ----------

const FIELDS = [
  'id', 'displayName', 'primaryType', 'primaryTypeDisplayName', 'types', 'rating', 'userRatingCount',
  'priceLevel', 'location', 'formattedAddress', 'googleMapsURI', 'regularOpeningHours',
  'utcOffsetMinutes', 'businessStatus',
];

const PRICE_LEVELS = { FREE: 0, INEXPENSIVE: 1, MODERATE: 2, EXPENSIVE: 3, VERY_EXPENSIVE: 4 };

let mapsPromise = null;

function loadGoogleMaps(apiKey) {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  mapsPromise ??= new Promise((resolve, reject) => {
    const callback = '__choicesMapsReady';
    window[callback] = () => resolve();
    // Google calls this global when the key is invalid or not allowed for this site.
    window.gm_authFailure = () => reject(new Error('Google rejected the API key. Check that the Places API (New) is enabled and this site is an allowed referrer.'));
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callback}`;
    script.async = true;
    script.onerror = () => {
      mapsPromise = null;
      reject(new Error('Could not load Google Maps. Check your network connection.'));
    };
    document.head.append(script);
  });
  return mapsPromise;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Nearby Search returns at most 20 places per request. A "deep" scan runs extra
 * requests per group of cuisine types to surface more variety (costs more API calls).
 */
export async function searchGoogle({ apiKey, center, radius, deep = false }) {
  await loadGoogleMaps(apiKey);
  const { Place, SearchNearbyRankPreference } = await google.maps.importLibrary('places');

  const typeGroups = [['restaurant'], ...(deep ? chunk(Object.keys(CUISINE_TYPES), 8) : [])];
  const responses = await Promise.all(typeGroups.map((includedTypes) =>
    Place.searchNearby({
      fields: FIELDS,
      locationRestriction: { center, radius },
      includedTypes,
      maxResultCount: 20,
      rankPreference: SearchNearbyRankPreference.POPULARITY,
    })));

  const unique = new Map();
  for (const { places } of responses) {
    for (const place of places) {
      if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') continue;
      unique.set(place.id, place);
    }
  }
  return Promise.all([...unique.values()].map((place) => normalizeGooglePlace(place, center)));
}

async function normalizeGooglePlace(place, center) {
  let openNow;
  try {
    openNow = await place.isOpen(); // undefined when Google has no hours for the place
  } catch {
    openNow = undefined;
  }
  const lat = place.location.lat();
  const lng = place.location.lng();
  return {
    id: place.id,
    name: place.displayName,
    cuisine: cuisineOf(place),
    rating: place.rating ?? null,
    reviews: place.userRatingCount ?? 0,
    priceLevel: PRICE_LEVELS[place.priceLevel] ?? null,
    lat,
    lng,
    address: place.formattedAddress ?? '',
    mapsUrl: place.googleMapsURI ?? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    openNow,
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

export async function searchDemo({ center, radius }) {
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
  return places;
}
