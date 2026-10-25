import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuisineOf, distanceMeters, filterPlaces, groupByCuisine, isFoodPlace, isOpenAt, score, weightedPick } from '../src/cuisine.js';

test('cuisineOf maps known Google types', () => {
  assert.equal(cuisineOf({ primaryType: 'sushi_restaurant', types: ['restaurant'] }), 'Sushi');
  assert.equal(cuisineOf({ primaryType: 'restaurant', types: ['restaurant', 'italian_restaurant'] }), 'Italian');
});

test('cuisineOf falls back to unknown *_restaurant types, then display name, then Other', () => {
  assert.equal(cuisineOf({ primaryType: 'georgian_restaurant' }), 'Georgian');
  assert.equal(cuisineOf({ primaryType: 'restaurant', primaryTypeDisplayName: 'Tapas bar' }), 'Tapas bar');
  assert.equal(cuisineOf({ primaryType: 'restaurant', primaryTypeDisplayName: 'Restaurant' }), 'Other');
});

test('score prefers many good reviews over few perfect ones', () => {
  assert.ok(score({ rating: 4.7, reviews: 2000 }) > score({ rating: 5.0, reviews: 3 }));
});

test('filterPlaces applies rating, review and open criteria', () => {
  const places = [
    { id: 'a', rating: 4.5, reviews: 100, openNow: true },
    { id: 'b', rating: 4.0, reviews: 100, openNow: true },
    { id: 'c', rating: 4.6, reviews: 5, openNow: true },
    { id: 'd', rating: 4.6, reviews: 100, openNow: false },
    { id: 'e', rating: 4.6, reviews: 100, openNow: undefined },
  ];
  const ids = (list) => list.map((p) => p.id);
  assert.deepEqual(ids(filterPlaces(places, { minRating: 4.2, minReviews: 30, openOnly: true })), ['a']);
  assert.deepEqual(ids(filterPlaces(places, { minRating: 4.2, minReviews: 30, openOnly: false })), ['a', 'd', 'e']);
});

test('groupByCuisine groups, sorts groups by size and places by score', () => {
  const groups = groupByCuisine([
    { name: 'T1', cuisine: 'Thai', rating: 4.3, reviews: 50, distance: 900 },
    { name: 'I1', cuisine: 'Italian', rating: 4.2, reviews: 10, distance: 300 },
    { name: 'I2', cuisine: 'Italian', rating: 4.8, reviews: 900, distance: 700 },
  ]);
  assert.deepEqual(groups.map((g) => g.cuisine), ['Italian', 'Thai']);
  assert.deepEqual(groups[0].places.map((p) => p.name), ['I2', 'I1']);
  assert.equal(groups[0].nearest, 300);
  assert.equal(groups[0].emoji, '🍝');
});

test('weightedPick respects weights', () => {
  assert.equal(weightedPick(['a', 'b'], (x) => (x === 'a' ? 1 : 3), () => 0.1), 'a');
  assert.equal(weightedPick(['a', 'b'], (x) => (x === 'a' ? 1 : 3), () => 0.5), 'b');
});

test('distanceMeters is roughly right', () => {
  const d = distanceMeters({ lat: 52.52, lng: 13.405 }, { lat: 52.53, lng: 13.405 });
  assert.ok(Math.abs(d - 1112) < 5, `got ${d}`);
});

test('cuisineOf prefers the primary type over secondary types', () => {
  // Borchardt in Berlin: primary german_restaurant, also tagged french_restaurant.
  assert.equal(cuisineOf({ primaryType: 'german_restaurant', types: ['german_restaurant', 'french_restaurant', 'restaurant'] }), 'German');
  assert.equal(cuisineOf({ primaryType: 'restaurant', types: ['restaurant', 'brunch_restaurant', 'japanese_restaurant'] }), 'Breakfast & Brunch');
});

test('isFoodPlace leaves out hotels and landmarks that only contain a restaurant', () => {
  assert.equal(isFoodPlace({ primaryType: 'hotel' }), false);
  assert.equal(isFoodPlace({ primaryType: 'historical_landmark' }), false);
  assert.equal(isFoodPlace({ primaryType: 'chicken_restaurant' }), true);
  assert.equal(isFoodPlace({ primaryType: 'restaurant' }), true);
  assert.equal(isFoodPlace({ primaryType: 'steak_house' }), true);
});

test('isOpenAt reads weekly periods in the place time zone', () => {
  // Every day 11:30-22:00 local time, place at UTC+1.
  const daily = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, hour: 11, minute: 30 }, close: { day, hour: 22, minute: 0 } }));
  const at = (iso) => new Date(iso);
  assert.equal(isOpenAt(daily, 60, at('2026-10-25T12:00:00Z')), true); // 13:00 local
  assert.equal(isOpenAt(daily, 60, at('2026-10-25T03:00:00Z')), false); // 04:00 local
  assert.equal(isOpenAt(daily, 60, at('2026-10-25T21:00:00Z')), false); // 22:00 local, just closed
  assert.equal(isOpenAt(daily, 60, at('2026-10-25T10:29:00Z')), false); // 11:29 local, not yet open
  assert.equal(isOpenAt(daily, 60, at('2026-10-25T10:30:00Z')), true); // 11:30 local, just opened
});

test('isOpenAt handles late nights, 24/7 and missing data', () => {
  // Saturday 18:00 to Sunday 02:00 (wraps around the end of the week).
  const lateSaturday = [{ open: { day: 6, hour: 18, minute: 0 }, close: { day: 0, hour: 2, minute: 0 } }];
  assert.equal(isOpenAt(lateSaturday, 0, new Date('2026-10-25T01:00:00Z')), true); // Sunday 01:00
  assert.equal(isOpenAt(lateSaturday, 0, new Date('2026-10-24T23:00:00Z')), true); // Saturday 23:00
  assert.equal(isOpenAt(lateSaturday, 0, new Date('2026-10-25T03:00:00Z')), false); // Sunday 03:00
  assert.equal(isOpenAt([{ open: { day: 0, hour: 0, minute: 0 } }], 60), true); // open 24 hours
  assert.equal(isOpenAt([], 60), undefined);
  assert.equal(isOpenAt(undefined, 60), undefined);
});

test('groupByCuisine puts Other last', () => {
  const groups = groupByCuisine([
    { cuisine: 'Other', rating: 4.5, reviews: 100, distance: 100 },
    { cuisine: 'Other', rating: 4.5, reviews: 100, distance: 100 },
    { cuisine: 'Thai', rating: 4.5, reviews: 100, distance: 100 },
  ]);
  assert.deepEqual(groups.map((g) => g.cuisine), ['Thai', 'Other']);
});
