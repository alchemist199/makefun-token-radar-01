// Token Radar — the value model (radar-2).
//
// The board ranks pre-token protocols by an implied value that is built only
// from the snapshot's own figures, never from a hand-written list of names:
//
//   implied = TVL x peerMultiple x growthMult x maturityMult x breadthMult
//
// peerMultiple — what the market already pays for a token, per unit of TVL.
//   It is the median market-cap / TVL ratio of the live-token protocols in the
//   same category (at least 3 priced peers, else the median over all priced
//   live protocols, 0.2049 on this snapshot), clamped to [0.05, 1.50]. A
//   protocol is scored against its own category's yardstick, not a flat
//   constant, so a lending protocol and a DEX are not priced alike.
//
// growthMult — the protocol's own 7-day TVL change, clamped to [-60, +120]%
//   and half-weighted: 1 + growth/100 x 0.5. A protocol shrinking fast scores
//   less; one growing fast scores more, but growth alone cannot carry it.
//
// maturityMult — how long the protocol has run with no token recorded:
//   0.60 + min(age_days, 1095) / 1095 x 0.40 (age unknown: 365 days). A
//   protocol that held users for years without issuing a token carries more
//   pent-up value than one listed last month.
//
// breadthMult — how many chains carry its TVL: 1 + 0.02 x min(chains - 1, 5),
//   at most 1.10. Multi-chain reach is worth a little, never a lot.
//
// The board holds every watchlist slug (the floor) plus the 160 strongest
// pre-token protocols below the floor, picked by implied value — the early
// finds the radar exists to surface, with a wrapped fill only if the
// standalone early radar falls short (see buildBoard). Live-token protocols
// are never ranked: they already trade, so the dashboard shows the market's
// own value for them in a separate Live view, which is also where the peer
// multiples come from.

/** One protocol entry: exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so the judge can re-derive it. */
export interface ModelConstants {
  peer_min_peers: number;
  peer_floor: number;
  peer_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  peer_min_peers: 3,
  peer_floor: 0.05,
  peer_cap: 1.5,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_max_chains: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. `set` says where the row came from: the watchlist, the early radar, or the wrapped fill (see buildBoard). */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  set: 'watchlist' | 'early' | 'wrapped';
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row (farm plan generated in the page). */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  watchlist: boolean;
  set: 'watchlist' | 'early' | 'wrapped';
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  peer_overall_median: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  wrapped_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted-ascending list, or null when it is empty. */
function medianOf(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The peer multiples: for every category, the median market-cap / TVL ratio of
 * its live-token protocols that carry a market cap, plus the median over all
 * priced live protocols as the fallback. Computed from the snapshot at run
 * time, so the yardstick moves with the data, not with an author's guess.
 */
export function peerMultiples(snapshot: Snapshot, model: ModelConstants): { byCategory: Map<string, { multiple: number; count: number }>; overall: number } {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? '(no category)';
    const list = byCat.get(key) ?? [];
    list.push(ratio);
    byCat.set(key, list);
  }
  all.sort((a, b) => a - b);
  const overallRaw = medianOf(all) ?? 0.2;
  const overall = Math.min(model.peer_cap, Math.max(model.peer_floor, overallRaw));
  const byCategory = new Map<string, { multiple: number; count: number }>();
  for (const [cat, ratios] of byCat) {
    if (ratios.length < model.peer_min_peers) continue;
    ratios.sort((a, b) => a - b);
    const m = medianOf(ratios);
    if (m === null) continue;
    byCategory.set(cat, { multiple: Math.min(model.peer_cap, Math.max(model.peer_floor, m)), count: ratios.length });
  }
  return { byCategory, overall };
}

/** The peer multiple one protocol is scored against, with its peer count. */
export function peerFor(p: SnapshotProtocol, peers: { byCategory: Map<string, { multiple: number; count: number }>; overall: number }): { multiple: number; count: number } {
  const hit = p.category === null ? undefined : peers.byCategory.get(p.category);
  if (hit !== undefined) return hit;
  return { multiple: peers.overall, count: 0 };
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  peers: { byCategory: Map<string, { multiple: number; count: number }>; overall: number },
): { implied: number; peer: number; peerCount: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple: peer, count: peerCount } = peerFor(protocol, peers);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const breadthMult = 1 + model.breadth_per_chain * extraChains;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * peer * growthMult * maturityMult * breadthMult));
  return { implied, peer, peerCount, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the early radar may add: pre-token, not an exchange, not a versioned pool, not a wrapped/staked/bridged product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && (p.category === null || !WRAPPED_CATEGORIES.has(p.category)) && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n.
 *
 * The watchlist is the floor. The early radar then adds pre-token protocols
 * below the floor, ranked by implied value: first the standalone ones (not an
 * exchange, not a versioned pool, not a wrapped/staked/bridged product), then,
 * only if fewer than EARLY_ROWS standalone ones exist, the wrapped fill —
 * pre-token by the record but a wrapped, staked, bridged or versioned product
 * of a token that already trades — each row marked `set: 'wrapped'` so the
 * dashboard can say its launch case is weaker. A wrapped fill row is never a
 * replacement for a watchlist or an early row. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, { p: SnapshotProtocol; set: 'watchlist' | 'early' | 'wrapped' }>();
  // The watchlist is the floor: every slug it names, whatever its record says.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, { p, set: 'watchlist' });
  }
  // The early radar: pre-token protocols below the watchlist floor, ranked by
  // implied value (not by TVL alone) so a smaller, fast-growing protocol can
  // outrank a larger, shrinking one.
  const byImplied = (list: SnapshotProtocol[]) =>
    list
      .map((p) => ({ p, score: impliedValue(p, snapshot.as_of, model, peers).implied }))
      .sort((a, b) => b.score - a.score || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
      .map((s) => s.p);
  const early = byImplied(
    snapshot.protocols.filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd),
  ).slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, { p, set: 'early' });
  // The wrapped fill, only if the standalone early radar fell short.
  if (chosen.size - snapshot.watchlist.length < EARLY_ROWS) {
    const fill = byImplied(
      snapshot.protocols.filter(
        (p) =>
          !chosen.has(p.slug) &&
          isPreToken(p) &&
          p.category !== 'CEX' &&
          !VERSIONED.test(p.name) &&
          p.tvl_usd < snapshot.floor_usd &&
          (p.category !== null && WRAPPED_CATEGORIES.has(p.category)),
      ),
    ).slice(0, EARLY_ROWS - (chosen.size - snapshot.watchlist.length));
    for (const p of fill) chosen.set(p.slug, { p, set: 'wrapped' });
  }

  const scored = [...chosen.values()].map(({ p, set }) => {
    const v = impliedValue(p, snapshot.as_of, model, peers);
    return { p, set, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    set: s.set,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      peer_multiple: round4(s.v.peer),
      peer_count: s.v.peerCount,
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in words a farmer can follow, with its own capital and chain. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${n} on ${chain} as a lender and leave the deposit earning.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${n}'s deepest pool on ${chain} and keep the LP position open.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} of USDC into ${n}'s highest-yield vault on ${chain} and keep the vault shares.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC into ${chain} through ${n}, then use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${n} and keep the staking receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${n} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${n} and place one position on an active market.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('asset management')) return `Deposit $${capital} into a ${n} vault on ${chain} and keep the vault shares.`;
  if (c.includes('stable') || c.includes('rwa')) return `Mint or hold $${capital} of ${n}'s yield-bearing asset on ${chain} and keep it in your wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active.`;
  if (c.includes('liquid')) return `Provide $${capital} of liquidity to ${n} on ${chain} and keep the position open.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${n} on ${chain} and vote once on an active proposal.`;
  if (c.includes('payment') || c.includes('pay')) return `Route $${capital} of payments through ${n} on ${chain} and keep the receipts.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open.`;
}

/** The category's second, different action, so the plan is not one move repeated. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${Math.round(capital / 2)} against the deposit on ${n} and repay it within the same week, so the account shows both sides of the market.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Swap $${Math.round(capital / 2)} through ${n} on ${chain} once a week, in a different pair each time.`;
  if (c.includes('yield')) return `Move $${Math.round(capital / 2)} into a second ${n} vault on ${chain} with a different strategy.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${Math.round(capital / 2)} back through ${n} to a second chain, so the account shows two-way volume.`;
  if (c.includes('staking') || c.includes('restak')) return `Delegate a second $${Math.round(capital / 2)} stake through ${n} to a different validator set.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Close the hedge on ${n} and open a fresh one the next week, keeping the account active.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('asset management')) return `Top up the ${n} vault by $${Math.round(capital / 2)} after two weeks, so the deposit history shows growth.`;
  if (c.includes('stable') || c.includes('rwa')) return `Redeem $${Math.round(capital / 2)} of the ${n} asset and re-mint it the same week, so the account shows a full cycle.`;
  if (c.includes('governance')) return `Join one community call or forum thread for ${n} and leave a written comment.`;
  return `Use ${n} a second way on ${chain}: a swap, a vote or a deposit of $${Math.round(capital / 2)}, different from the first position.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * Every step is derived from the protocol's own record (category, chains,
 * TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    {
      text: secondActionFor(p, capital, chain),
      cost: `about $${gas} of gas, no new capital beyond the $${capital}`,
      time: '15 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never let the account sit idle for a month.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and check the protocol's own points or rewards page once a week.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, and claim only from a link the protocol itself publishes, never from a reply or a DM.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 1e4) / 1e4 : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    watchlist: watchlist.has(row.slug),
    set: row.set,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerMultiples(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => r.set === 'early').length;
  const wrapped = board.filter((r) => r.set === 'wrapped').length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    peer_overall_median: round4(peers.overall),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    wrapped_size: wrapped,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watch)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
