/** Shared claim-title + datetime helpers. No server-only import -- used by
 *  both server pages (browse-cases, activity) and client forms. */

export type ClaimSummary = {
  claim_id: string;
  claim_type: string;
  asset: string;
  asset_b: string | null;
  metric: string | null;
  direction: string;
  threshold: string;
  state: string;
  consensus_result: string;
  verdict_text: string;
  stake_for_total: string;
  stake_against_total: string;
  deadline: string;
  created_at: string;
  poster: string;
  origin_contract?: string;
  /** ISO datetime when CONTESTED was entered. Empty until then. */
  contested_at?: string;
  appeal_outcome?: string;
  appeal_bond?: string;
  appeal_filer?: string | null;
};

export type ClaimTitleInput = {
  claim_type: string;
  asset: string;
  asset_b?: string | null;
  metric?: string | null;
  direction?: string | null;
  threshold?: string | null;
};

export function claimTitle(claim: ClaimTitleInput): string {
  if (claim.claim_type === "RELATIVE_PERFORMANCE") {
    return `${claim.asset} vs ${claim.asset_b ?? "?"}`;
  }
  if (claim.claim_type === "FUNDAMENTALS_THRESHOLD") {
    return `${claim.metric ?? "metric"} (${claim.asset}) ${claim.direction ?? ""} ${claim.threshold ?? ""}`.trim();
  }
  return `${claim.asset} ${claim.direction ?? ""} ${claim.threshold ?? ""}`.trim();
}

/** Value for <input type="datetime-local"> -- must be local, not UTC.
 *  Real incident (Build Prompt 11): filling this input from toISOString()
 *  wrote UTC into a local-time field, then submit parsed it as local and
 *  the deadline was already in the past by the time consensus ran. */
export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDeadlineUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function formatMark(raw: string | null | undefined): string {
  if (raw == null || raw === "") return "pending";
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(n) >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function prettyState(state: string): string {
  return state.replace(/_/g, " ");
}

/**
 * Keeper ticks every 60s; create_claim consensus often takes 30–90s and
 * the contract rejects a deadline that is already past by the time
 * consensus runs. Five minutes leaves a real window after a slow create
 * plus at least one keeper tick to lock after expiry.
 */
export const MIN_DEADLINE_MS = 5 * 60 * 1000;

export function verdictPlainSummary(claim: {
  claim_type: string;
  asset: string;
  asset_b?: string | null;
  metric?: string | null;
  direction?: string | null;
  threshold?: string | null;
  deadline: string;
  deadline_price?: string | null;
  deadline_price_b?: string | null;
  consensus_result: string;
}): string | null {
  if (claim.consensus_result !== "HELD" && claim.consensus_result !== "BROKEN") return null;
  const when = formatDeadlineUtc(claim.deadline);
  const forWon = claim.consensus_result === "HELD";
  const winner = forWon ? "FOR" : "AGAINST";
  if (claim.claim_type === "RELATIVE_PERFORMANCE") {
    const a = formatMark(claim.deadline_price);
    const b = formatMark(claim.deadline_price_b);
    const verb = forWon ? "finished ahead of" : "did not finish ahead of";
    return `At ${when}, ${claim.asset} was ${a} and ${claim.asset_b ?? "the other asset"} was ${b}. ${claim.asset} ${verb} ${claim.asset_b ?? "the other asset"}, so ${winner} won.`;
  }
  const label =
    claim.claim_type === "FUNDAMENTALS_THRESHOLD"
      ? `${claim.metric ?? "metric"} (${claim.asset})`
      : claim.asset;
  const price = formatMark(claim.deadline_price);
  const threshold = formatMark(claim.threshold);
  const dir = (claim.direction || "above").toLowerCase() === "below" ? "below" : "above";
  const relation = forWon ? dir : `not ${dir}`;
  return `At ${when}, ${label} was ${price} — ${relation} ${threshold}, so ${winner} won.`;
}

export function formatGen(raw: string | number): string {
  const n = typeof raw === "number" ? raw : parseFloat(raw);
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function typeLabel(type: string): string {
  if (type === "PRICE_THRESHOLD") return "Price";
  if (type === "RELATIVE_PERFORMANCE") return "Relative";
  if (type === "FUNDAMENTALS_THRESHOLD") return "Fundamentals";
  return type.replace(/_/g, " ");
}

export function isDeadlinePassed(iso: string, nowMs = Date.now()): boolean {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t <= nowMs;
}

export function formatRelative(ms: number): string {
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h`;
  const day = Math.round(hr / 24);
  return `${day}d`;
}

export function activityTiming(claim: { state: string; deadline: string }, nowMs = Date.now()): string {
  const t = new Date(claim.deadline).getTime();
  if (!Number.isFinite(t)) return "";
  if (claim.state === "OPEN" && t > nowMs) return `${formatRelative(t - nowMs)} left`;
  if (claim.state === "OPEN" || claim.state === "EVIDENCE_LOCKED") return "settling";
  if (claim.state === "CONTESTED" || claim.state === "APPEAL_PENDING") return "on appeal";
  return `resolved ${formatRelative(nowMs - t)} ago`;
}

export function activityOrder<
  T extends { state: string; deadline: string; claim_id: string; created_at?: string },
>(claims: T[]): T[] {
  const rank = (state: string) => {
    if (state === "OPEN") return 0;
    if (state === "EVIDENCE_LOCKED") return 1;
    if (state === "CONTESTED" || state === "APPEAL_PENDING") return 2;
    return 3;
  };
  const recency = (c: T, group: number) => {
    const created = c.created_at ? new Date(c.created_at).getTime() : NaN;
    const deadline = new Date(c.deadline).getTime();
    if (group >= 3) return Number.isFinite(deadline) ? deadline : created;
    return Number.isFinite(created) ? created : deadline;
  };
  return [...claims].sort((a, b) => {
    const pa = isPendingClaimId(a.claim_id) ? 1 : 0;
    const pb = isPendingClaimId(b.claim_id) ? 1 : 0;
    if (pa !== pb) return pa - pb;
    const ra = rank(a.state);
    const rb = rank(b.state);
    if (ra !== rb) return ra - rb;
    return recency(b, ra) - recency(a, ra);
  });
}

/** Contract stake_for/against require state OPEN. Deadline is a UI close:
 *  once it has passed the keeper's lock_deadline_evidence is the next
 *  write, and staking will revert "claim is not OPEN" as soon as that
 *  lock lands — often already has. */
export function stakingWindowOpen(state: string, deadline: string, nowMs = Date.now()): boolean {
  return state === "OPEN" && !isDeadlinePassed(deadline, nowMs);
}

/**
 * Map the contract's real UserError strings (already prefixed
 * `[EXPECTED]`) to a sentence that says what happened, without replacing
 * the on-chain reason. unknown claim_id and claim is not OPEN are
 * distinct contract errors — they must not be collapsed into each other.
 */
export function explainContractError(message: string): string {
  const raw = message.trim();
  if (/that id is not in the contract|already left OPEN|staking window closed/i.test(raw)) {
    return raw;
  }
  if (/unknown claim_id/i.test(raw)) {
    return `${raw} — that id is not in the contract (a local pending-* id is the usual cause). The call reverted; no GEN was recorded as a stake.`;
  }
  if (/claim is not OPEN/i.test(raw)) {
    return `${raw} — the claim has already left OPEN (locked or resolved), so stake and lock are contractually impossible.`;
  }
  if (/deadline has not passed yet/i.test(raw)) {
    return `${raw} — too early to freeze the deadline price.`;
  }
  if (/deadline snapshot already locked/i.test(raw)) {
    return `${raw} — the deadline price is already frozen.`;
  }
  if (/claim is not EVIDENCE_LOCKED/i.test(raw)) {
    return `${raw} — verdict was already taken, or evidence is not locked yet.`;
  }
  return raw;
}

/** On-chain ids are decimal strings from next_claim_id. Local pins used
 *  `pending-*` and those must never be sent to stake_for/stake_against. */
export function isOnChainClaimId(id: string | null | undefined): boolean {
  return typeof id === "string" && /^\d+$/.test(id.trim());
}

export function isPendingClaimId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.trim().length > 0 && !isOnChainClaimId(id);
}
