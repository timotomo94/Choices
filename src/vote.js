// Pure group-vote logic. A ballot is one person's picks: { [cuisine]: points },
// where 1 means "happy with it" and 2 means "really want it" (at most one per ballot).

/** The ballot after tapping a cuisine: none -> 1 -> 2 -> none. Only one cuisine can hold 2. */
export function tapBallot(ballot, cuisine) {
  const next = { ...ballot };
  const current = next[cuisine] ?? 0;
  if (current === 0) {
    next[cuisine] = 1;
  } else if (current === 1) {
    for (const other of Object.keys(next)) {
      if (next[other] === 2) next[other] = 1;
    }
    next[cuisine] = 2;
  } else {
    delete next[cuisine];
  }
  return next;
}

/**
 * Adds up all ballots. Returns the ranking (most points first), the winner, and the
 * cuisines that tied for first place. A tie is broken at random; `rand` is injectable for tests.
 */
export function decideVote(ballots, rand = Math.random) {
  const totals = new Map();
  for (const ballot of ballots) {
    for (const [cuisine, points] of Object.entries(ballot)) {
      const entry = totals.get(cuisine) ?? { cuisine, points: 0, voters: 0 };
      entry.points += points;
      entry.voters += 1;
      totals.set(cuisine, entry);
    }
  }
  const ranking = [...totals.values()].sort((a, b) => b.points - a.points || a.cuisine.localeCompare(b.cuisine));
  if (!ranking.length) return { ranking, winner: null, tied: [] };
  const tied = ranking.filter((r) => r.points === ranking[0].points).map((r) => r.cuisine);
  const winner = tied[Math.min(tied.length - 1, Math.floor(rand() * tied.length))];
  return { ranking, winner, tied: tied.length > 1 ? tied : [] };
}
