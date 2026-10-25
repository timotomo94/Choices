import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuisineOf, distanceMeters, filterPlaces, groupByCuisine, score, weightedPick } from '../src/cuisine.js';

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
