// Pen marks: SVG path data for the hand-drawn loops, strikes, ticks and tally strokes.
// Pure geometry with no DOM, so it can be unit-tested with plain Node.
import { mulberry32 } from './prng.js';

const round = (n) => Math.round(n * 10) / 10;

/** A smooth curve through the points (a Catmull-Rom spline written as cubic Béziers). */
function curveThrough(points) {
  const at = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  let d = `M${round(points[0][0])} ${round(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    d += `C${round(p1[0] + (p2[0] - p0[0]) / 6)} ${round(p1[1] + (p2[1] - p0[1]) / 6)}`
      + ` ${round(p2[0] - (p3[0] - p1[0]) / 6)} ${round(p2[1] - (p3[1] - p1[1]) / 6)}`
      + ` ${round(p2[0])} ${round(p2[1])}`;
  }
  return d;
}

/**
 * A loop drawn around a width × height box in one pen stroke. It starts at the upper
 * left, goes round clockwise and overshoots its own start, the way a quick circle on
 * paper does. `nib` is the stroke width, so the overshoot clears the start of the line.
 */
export function loopPath(width, height, seed = 1, nib = 2.75) {
  const rand = mulberry32(seed);
  const aspect = width / height;
  const drift = nib * 1.1; // the stroke ends this far outside the ideal loop, and starts as far inside
  const rx = width / 2 - nib / 2 - drift;
  const ry = height / 2 - nib / 2 - drift;
  // Long words get a squarer, pill-like loop; a plain ellipse would cut their corners.
  const squareness = 2 / Math.min(4.4, 2.6 + 0.2 * aspect);
  const start = Math.PI * (1.13 + rand() * 0.1); // upper left
  // A full turn plus an overshoot. Wide loops overshoot by less of a turn, or the tail would run halfway along the top.
  const sweep = Math.PI * (2 + (0.2 + rand() * 0.14) / Math.max(1, Math.sqrt(aspect / 3)));
  const tilt = (rand() - 0.5) * 0.05;
  const phase = rand() * Math.PI * 2;
  const steps = 56;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = start + sweep * t;
    const wobble = 1 + 0.016 * Math.sin(2 * angle + phase);
    const grow = drift * (2 * t - 1);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = (rx + grow) * wobble * Math.sign(cos) * Math.abs(cos) ** squareness;
    const y = (ry + grow) * wobble * Math.sign(sin) * Math.abs(sin) ** squareness;
    points.push([
      width / 2 + x * Math.cos(tilt) - y * Math.sin(tilt),
      height / 2 + x * Math.sin(tilt) + y * Math.cos(tilt),
    ]);
  }
  return curveThrough(points);
}

/** A single stroke through a width × height box, left to right and slightly uphill. */
export function strikePath(width, height, seed = 1) {
  const rand = mulberry32(seed);
  const from = height * (0.55 + rand() * 0.08);
  const to = height * (0.4 + rand() * 0.08);
  const bow = height * (0.1 + rand() * 0.08);
  return `M2 ${round(from)}C${round(width * 0.3)} ${round(from - bow)}`
    + ` ${round(width * 0.68)} ${round(to + bow)} ${round(width - 2)} ${round(to)}`;
}

// Marks for a tick box. The box sits at 8..32 of a 40 × 40 square; pen strokes run over its edges.
/** One tick, and the second one that joins it for "counts double". */
export const TICKS = [
  'M10.5 20C12.5 22 15 25.5 16.5 29.5C19.5 21 25 12 33 4.5',
  'M20 21.5C22 23.5 24.5 27 26 31C29 22.5 34.5 14 42.5 6.5',
];
export const CROSS = [
  'M11 10.5C16.5 16 23.5 23 30 30.5',
  'M30 9.5C24 15.5 17 23 10 31',
];

/**
 * Tally strokes for a count: upright strokes in groups, every fifth one crossing the
 * four before it. Returns the path of each stroke and the size of the drawing.
 */
export function tallyStrokes(count, seed = 1) {
  const rand = mulberry32(seed);
  const height = 22;
  const top = 2.5;
  const bottom = height - 2.5;
  const gap = 6.5;
  const groupGap = 13;
  const paths = [];
  let x = 4; // where the next upright stroke goes
  let right = 0;
  for (let i = 0; i < count; i++) {
    if (i % 5 === 4) {
      const from = x - 4 * gap - 4;
      const to = x - gap + 5;
      paths.push(`M${round(from)} ${round(bottom - 4 - rand() * 2)}L${round(to)} ${round(top + 4 + rand() * 2)}`);
      right = to;
      x += groupGap - gap;
    } else {
      const lean = 1 + rand() * 1.4;
      const at = x + (rand() - 0.5);
      paths.push(`M${round(at + lean)} ${round(top + rand() * 1.5)}L${round(at)} ${round(bottom - rand() * 1.5)}`);
      right = at + lean;
      x += gap;
    }
  }
  return { width: Math.ceil(right + 3), height, paths };
}
