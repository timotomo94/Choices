import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VETO, decideVote, tapBallot, vetoBallot } from '../src/vote.js';

test('tapBallot cycles none -> 1 -> 2 -> none', () => {
  let b = tapBallot({}, 'Thai');
  assert.deepEqual(b, { Thai: 1 });
  b = tapBallot(b, 'Thai');
  assert.deepEqual(b, { Thai: 2 });
  b = tapBallot(b, 'Thai');
  assert.deepEqual(b, {});
});

test('tapBallot allows several 1s but only one 2', () => {
  let b = { Thai: 2, Italian: 1, Sushi: 1 };
  b = tapBallot(b, 'Italian');
  assert.deepEqual(b, { Thai: 1, Italian: 2, Sushi: 1 });
});

test('tapBallot does not change the ballot it was given', () => {
  const original = { Thai: 1 };
  tapBallot(original, 'Thai');
  assert.deepEqual(original, { Thai: 1 });
});

test('decideVote adds points across ballots and ranks them', () => {
  const result = decideVote([{ Thai: 2, Italian: 1 }, { Italian: 1 }, { Thai: 1, Sushi: 1 }]);
  assert.deepEqual(result.ranking, [
    { cuisine: 'Thai', points: 3, voters: 2 },
    { cuisine: 'Italian', points: 2, voters: 2 },
    { cuisine: 'Sushi', points: 1, voters: 1 },
  ]);
  assert.equal(result.winner, 'Thai');
  assert.deepEqual(result.tied, []);
  assert.deepEqual(result.vetoed, []);
});

test('decideVote breaks a tie for first place at random', () => {
  const ballots = [{ Thai: 2 }, { Italian: 2 }, { Sushi: 1 }];
  assert.equal(decideVote(ballots, () => 0).winner, 'Italian');
  assert.equal(decideVote(ballots, () => 0.99).winner, 'Thai');
  assert.deepEqual(decideVote(ballots, () => 0).tied, ['Italian', 'Thai']);
  // A tie lower down doesn't count as a tie.
  assert.deepEqual(decideVote([{ Thai: 2 }, { Italian: 1 }, { Sushi: 1 }]).tied, []);
});

test('decideVote with no votes has no winner', () => {
  assert.deepEqual(decideVote([]), { ranking: [], vetoed: [], winner: null, tied: [] });
  assert.equal(decideVote([{}]).winner, null);
});

test('vetoBallot sets one veto, moves it, and removes it when tapped again', () => {
  let b = vetoBallot({ Thai: 2 }, 'Sushi');
  assert.deepEqual(b, { Thai: 2, Sushi: VETO });
  b = vetoBallot(b, 'Italian');
  assert.deepEqual(b, { Thai: 2, Italian: VETO });
  b = vetoBallot(b, 'Italian');
  assert.deepEqual(b, { Thai: 2 });
  // Vetoing a cuisine you had picked replaces the pick.
  assert.deepEqual(vetoBallot({ Thai: 2 }, 'Thai'), { Thai: VETO });
});

test('tapBallot on a vetoed cuisine removes the veto', () => {
  assert.deepEqual(tapBallot({ Sushi: VETO, Thai: 1 }, 'Sushi'), { Thai: 1 });
  // Making another cuisine the favourite leaves the veto alone.
  assert.deepEqual(tapBallot({ Sushi: VETO, Thai: 1 }, 'Thai'), { Sushi: VETO, Thai: 2 });
});

test('decideVote: one veto rules a cuisine out, whatever its points', () => {
  const result = decideVote([{ Thai: 2 }, { Thai: 2 }, { Italian: 1, Thai: VETO }]);
  assert.equal(result.winner, 'Italian');
  assert.deepEqual(result.ranking, [{ cuisine: 'Italian', points: 1, voters: 1 }]);
  assert.deepEqual(result.vetoed, [{ cuisine: 'Thai', vetoes: 1, points: 4 }]);
});

test('decideVote: no winner when every voted cuisine is vetoed', () => {
  const result = decideVote([{ Thai: 2, Italian: VETO }, { Italian: 1, Thai: VETO }]);
  assert.equal(result.winner, null);
  assert.deepEqual(result.vetoed.map((v) => v.cuisine), ['Italian', 'Thai']);
});
