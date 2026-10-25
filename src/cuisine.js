// Pure helpers: cuisine detection, filtering, scoring and grouping.
// No DOM or Google dependencies, so this file can be unit-tested with plain Node.

// Google Places (New) "Table A" restaurant types we can search on directly.
export const CUISINE_TYPES = {
  american_restaurant: 'American',
  barbecue_restaurant: 'Barbecue',
  brazilian_restaurant: 'Brazilian',
  breakfast_restaurant: 'Breakfast & Brunch',
  brunch_restaurant: 'Breakfast & Brunch',
  chinese_restaurant: 'Chinese',
  fast_food_restaurant: 'Fast food',
  french_restaurant: 'French',
  greek_restaurant: 'Greek',
  hamburger_restaurant: 'Burgers',
  indian_restaurant: 'Indian',
  indonesian_restaurant: 'Indonesian',
  italian_restaurant: 'Italian',
  japanese_restaurant: 'Japanese',
  korean_restaurant: 'Korean',
  lebanese_restaurant: 'Lebanese',
  mediterranean_restaurant: 'Mediterranean',
  mexican_restaurant: 'Mexican',
  middle_eastern_restaurant: 'Middle Eastern',
  pizza_restaurant: 'Pizza',
  ramen_restaurant: 'Ramen',
  seafood_restaurant: 'Seafood',
  spanish_restaurant: 'Spanish',
  steak_house: 'Steakhouse',
  sushi_restaurant: 'Sushi',
  thai_restaurant: 'Thai',
  turkish_restaurant: 'Turkish',
  vegan_restaurant: 'Vegan',
  vegetarian_restaurant: 'Vegetarian',
  vietnamese_restaurant: 'Vietnamese',
  sandwich_shop: 'Sandwiches',
};

export const CUISINE_EMOJI = {
  American: '🇺🇸', Barbecue: '🍖', Brazilian: '🇧🇷', 'Breakfast & Brunch': '🥞', Chinese: '🥡',
  'Fast food': '🍟', French: '🥐', Greek: '🥙', Burgers: '🍔', Indian: '🍛', Indonesian: '🍢',
  Italian: '🍝', Japanese: '🍱', Korean: '🍲', Lebanese: '🧆', Mediterranean: '🫒', Mexican: '🌮',
  'Middle Eastern': '🧆', Pizza: '🍕', Ramen: '🍜', Seafood: '🦞', Spanish: '🥘', Steakhouse: '🥩',
  Sushi: '🍣', Thai: '🌶️', Turkish: '🥙', Vegan: '🥗', Vegetarian: '🥦', Vietnamese: '🍜',
  Sandwiches: '🥪', German: '🥨', Bavarian: '🥨', Chicken: '🍗', Asian: '🥢', Other: '🍽️',
};

// Primary types that mean "this is mainly a place to eat". Anything else (hotels,
// landmarks, museums with a restaurant inside) is left out.
const FOOD_PRIMARY_TYPES = new Set([
  'restaurant', 'steak_house', 'sandwich_shop', 'diner', 'food_court', 'cafe', 'bakery', 'deli',
  'bistro', 'brasserie', 'gastropub', 'pub', 'bar_and_grill', 'noodle_shop', 'meal_takeaway',
]);

export function isFoodPlace({ primaryType } = {}) {
  return !primaryType || primaryType.endsWith('_restaurant') || FOOD_PRIMARY_TYPES.has(primaryType);
}

// Types that say "this is food" but nothing about the cuisine.
const GENERIC_TYPES = new Set([
  'restaurant', 'food', 'point_of_interest', 'establishment', 'meal_takeaway', 'meal_delivery',
  'store', 'bar', 'cafe', 'bakery', 'fine_dining_restaurant', 'buffet_restaurant',
  'family_restaurant', 'diner', 'food_court',
]);

function titleCase(slug) {
  return slug.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Best-effort cuisine label for a place, from its primary type and type list. */
function cuisineFromType(t) {
  if (CUISINE_TYPES[t]) return CUISINE_TYPES[t];
  // Newer Google types (e.g. "georgian_restaurant") we don't have in the table.
  if (t.endsWith('_restaurant') && !GENERIC_TYPES.has(t)) return titleCase(t.replace(/_restaurant$/, ''));
  return null;
}

export function cuisineOf({ primaryType, types = [], primaryTypeDisplayName } = {}) {
  // The primary type wins: a German restaurant that also serves French dishes is German.
  const fromPrimary = primaryType && cuisineFromType(primaryType);
  if (fromPrimary) return fromPrimary;
  const known = types.find((t) => CUISINE_TYPES[t]);
  if (known) return CUISINE_TYPES[known];
  for (const t of types) {
    const c = cuisineFromType(t);
    if (c) return c;
  }
  if (primaryTypeDisplayName && !/^(restaurant|food)$/i.test(primaryTypeDisplayName)) return primaryTypeDisplayName;
  return 'Other';
}

/**
 * Whether a place is open at `now`, from Google's weekly opening periods
 * (`regularOpeningHours.periods`) and the place's UTC offset. Undefined when unknown.
 * Holiday hours are not included in these periods.
 */
export function isOpenAt(periods, utcOffsetMinutes, now = new Date()) {
  if (!periods?.length || utcOffsetMinutes == null) return undefined;
  const WEEK = 7 * 1440;
  const local = new Date(now.getTime() + utcOffsetMinutes * 60000);
  const t = local.getUTCDay() * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes();
  const at = (p) => p.day * 1440 + (p.hour ?? 0) * 60 + (p.minute ?? 0);
  return periods.some(({ open, close }) => {
    if (!close) return true; // Google's way of saying "open 24 hours"
    const o = at(open);
    let c = at(close);
    if (c <= o) c += WEEK; // wraps past Saturday night
    return (t >= o && t < c) || (t + WEEK >= o && t + WEEK < c);
  });
}

/** Great-circle distance in metres. */
export function distanceMeters(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Rating adjusted for review count (Bayesian average), so a 5.0 with 3 reviews
 * doesn't beat a 4.7 with 2,000 reviews.
 */
export function score({ rating = 0, reviews = 0 }, prior = 4.0, weight = 50) {
  return (reviews / (reviews + weight)) * rating + (weight / (reviews + weight)) * prior;
}

/** Applies the user's criteria. Places with unknown opening hours are dropped when openOnly is set. */
export function filterPlaces(places, { minRating = 0, minReviews = 0, openOnly = true } = {}) {
  return places.filter((p) =>
    (p.rating ?? 0) >= minRating &&
    (p.reviews ?? 0) >= minReviews &&
    (!openOnly || p.openNow === true));
}

/** Groups places by cuisine; groups are sorted by size, then by average score. */
export function groupByCuisine(places) {
  const groups = new Map();
  for (const p of places) {
    if (!groups.has(p.cuisine)) groups.set(p.cuisine, []);
    groups.get(p.cuisine).push(p);
  }
  return [...groups].map(([cuisine, list]) => {
    list.sort((a, b) => score(b) - score(a));
    const avgRating = list.reduce((s, p) => s + (p.rating ?? 0), 0) / list.length;
    const avgScore = list.reduce((s, p) => s + score(p), 0) / list.length;
    const nearest = Math.min(...list.map((p) => p.distance ?? Infinity));
    return { cuisine, emoji: CUISINE_EMOJI[cuisine] ?? '🍽️', places: list, count: list.length, avgRating, avgScore, nearest };
  }).sort((a, b) => (a.cuisine === 'Other') - (b.cuisine === 'Other') || b.count - a.count || b.avgScore - a.avgScore);
}

/** Picks an item at random, weighted by weightFn. `rand` is injectable for tests. */
export function weightedPick(items, weightFn, rand = Math.random) {
  const weights = items.map(weightFn);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}
