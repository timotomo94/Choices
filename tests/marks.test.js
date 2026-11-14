import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CROSS, TICKS, loopPath, strikePath, tallyStrokes } from '../src/marks.js';
import { mulberry32, seedFrom } from '../src/prng.js';

/** All the x/y pairs in a path string. */
function coords(d) {
  const numbers = d.match(/-?\d+(\.\d+)?/g).map(Number);
  const points = [];
  for (let i = 0; i < numbers.length; i += 2) points.push([numbers[i], numbers[i + 1]]);
  return points;
}

test('seedFrom and mulberry32 are deterministic', () => {
  assert.equal(seedFrom('Italian'), seedFrom('Italian'));
  assert.notEqual(seedFrom('Italian'), seedFrom('Thai'));
  const a = mulberry32(42);
  const b = mulberry32(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  const value = mulberry32(7)();
  assert.ok(value >= 0 && value < 1);
});

test('loopPath is a single smooth stroke that stays around its box', () => {
  for (const [w, h] of [[80, 40], [320, 44], [180, 110]]) {
    const d = loopPath(w, h, seedFrom('Mediterranean'), 3);
    assert.match(d, /^M[\d.-]+ [\d.-]+C/);
    assert.equal(d.match(/M/g).length, 1, 'one stroke');
    for (const [x, y] of coords(d)) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.ok(x > -8 && x < w + 8 && y > -8 && y < h + 8, `(${x}, ${y}) is near the ${w}×${h} box`);
    }
  }
});

test('loopPath goes all the way round and overshoots its start', () => {
  const points = coords(loopPath(200, 60, 3));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  // Reaches all four sides of the box...
  assert.ok(Math.min(...xs) < 15 && Math.max(...xs) > 185);
  assert.ok(Math.min(...ys) < 12 && Math.max(...ys) > 48);
  // ...and ends in the top half, past where it started.
  const [startX, startY] = points[0];
  const [endX, endY] = points.at(-1);
  assert.ok(startX < 100 && startY < 30, 'starts upper left');
  assert.ok(endY < 30 && endX > startX, 'ends further along the top');
});

test('loopPath: same seed gives the same loop, another seed a different one', () => {
  assert.equal(loopPath(120, 40, 5), loopPath(120, 40, 5));
  assert.notEqual(loopPath(120, 40, 5), loopPath(120, 40, 6));
});

test('strikePath crosses the box from left to right', () => {
  const points = coords(strikePath(150, 30, 9));
  assert.deepEqual(points[0].slice(0, 1), [2]);
  assert.equal(points.at(-1)[0], 148);
  for (const [, y] of points) assert.ok(y > 0 && y < 30);
});

test('tick and cross marks are two strokes each', () => {
  assert.equal(TICKS.length, 2);
  assert.equal(CROSS.length, 2);
  for (const d of [...TICKS, ...CROSS]) assert.match(d, /^M[\d.]+ [\d.]+C/);
});

test('tallyStrokes draws one stroke per point, every fifth across the group', () => {
  assert.deepEqual(tallyStrokes(0), { width: 3, height: 22, paths: [] });
  const seven = tallyStrokes(7, 1);
  assert.equal(seven.paths.length, 7);
  const span = (d) => { const [[x1], [x2]] = coords(d); return Math.abs(x2 - x1); };
  // Upright strokes barely move sideways; the fifth one spans its whole group.
  assert.ok(span(seven.paths[0]) < 3);
  assert.ok(span(seven.paths[4]) > 20);
  assert.ok(span(seven.paths[5]) < 3);
  // The drawing is wide enough for all strokes and grows with the count.
  for (const d of seven.paths) for (const [x] of coords(d)) assert.ok(x >= 0 && x <= seven.width);
  assert.ok(tallyStrokes(12, 1).width > seven.width);
});
