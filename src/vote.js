// Pure group-vote logic. A ballot is one person's picks: { [cuisine]: points },
// where 1 means "happy with it", 2 means "really want it" and VETO means "not this one".
// A ballot holds at most one 2 and at most one VETO.

export const VETO = -1;

/** The ballot after tapping a cuisine: none -> 1 -> 2 -> none. Only one cuisine can hold 2. */
export function tapBallot(ballot, cuisine) {
  const next = { ...ballot };
  const current = next[cuisine] ?? 0;
  if (current === VETO) {
    delete next[cuisine];
  } else if (current === 0) {
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

/** The ballot after tapping a cuisine in veto mode: sets the one veto, or removes it if tapped again. */
export function vetoBallot(ballot, cuisine) {
  const next = { ...ballot };
  const wasVetoed = next[cuisine] === VETO;
  for (const other of Object.keys(next)) {
    if (next[other] === VETO) delete next[other];
  }
  if (!wasVetoed) next[cuisine] = VETO;
  return next;
}

/**
 * Adds up all ballots. A cuisine anyone vetoed is out, whatever its points. Returns the
 * ranking of the remaining cuisines (most points first), the vetoed cuisines, the winner,
 * and the cuisines that tied for first place. A tie is broken at random; `rand` is
 * injectable for tests.
 */
export function decideVote(ballots, rand = Math.random) {
  const totals = new Map();
  const vetoes = new Map();
  for (const ballot of ballots) {
    for (const [cuisine, points] of Object.entries(ballot)) {
      if (points === VETO) {
        vetoes.set(cuisine, (vetoes.get(cuisine) ?? 0) + 1);
        continue;
      }
      const entry = totals.get(cuisine) ?? { cuisine, points: 0, voters: 0 };
      entry.points += points;
      entry.voters += 1;
      totals.set(cuisine, entry);
    }
  }
  const byName = (a, b) => a.cuisine.localeCompare(b.cuisine);
  const ranking = [...totals.values()].filter((r) => !vetoes.has(r.cuisine)).sort((a, b) => b.points - a.points || byName(a, b));
  const vetoed = [...vetoes].map(([cuisine, count]) => ({ cuisine, vetoes: count, points: totals.get(cuisine)?.points ?? 0 })).sort(byName);
  if (!ranking.length) return { ranking, vetoed, winner: null, tied: [] };
  const tied = ranking.filter((r) => r.points === ranking[0].points).map((r) => r.cuisine);
  const winner = tied[Math.min(tied.length - 1, Math.floor(rand() * tied.length))];
  return { ranking, vetoed, winner, tied: tied.length > 1 ? tied : [] };
}
