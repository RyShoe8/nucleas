import type { DealMetrics, DealMetricsMode, DealMetricsSource } from "./types";

export type DealMetricsLlmPartial = {
  you_pay: number | null;
  baseline_value: number | null;
  pay_unit?: string | null;
  credit_unit?: string | null;
  mode: DealMetricsMode;
  confidence: number;
};

function parseMoney(s: string): number | null {
  const t = s.replace(/,/g, "").trim();
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function clampSavings(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(0.99, Math.max(0, pct));
}

/** A bonus is not a saving: getting 4x what you pay is a 300% bonus. Bounded only against absurd parses. */
function clampBonus(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(10, Math.max(0, pct));
}

function reEsc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Normalize currency/unit labels for comparison. */
export function normalizeUnit(unit: string | undefined | null): string {
  if (!unit) return "USD";
  const t = unit.trim().toUpperCase();
  if (t === "$" || t === "USD" || t === "DOLLAR" || t === "DOLLARS") return "USD";
  return t;
}

export function unitsAreComparable(payUnit: string, creditUnit: string): boolean {
  return normalizeUnit(payUnit) === normalizeUnit(creditUnit);
}

/** Build case-insensitive suffix alternation for unit tokens (excludes bare `$`, handled as currency). */
export function buildUnitSuffixPattern(unitTokens: readonly string[]): string | null {
  const parts = unitTokens
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t !== "$")
    .map((t) => reEsc(t));
  if (parts.length === 0) return null;
  return `(?:${parts.join("|")})`;
}

/** Deal detected but pay/credit units differ (e.g. USD vs SC) — not used for min-deal filters. */
function buildIncomparableDealMetrics(
  youPay: number,
  baseline: number,
  mode: DealMetricsMode,
  confidence: number,
  source: DealMetricsSource,
  payUnit: string,
  creditUnit: string,
): DealMetrics {
  const bonus_pct =
    youPay > 0 && baseline > youPay ? clampBonus((baseline - youPay) / youPay) : undefined;
  return {
    mode,
    you_pay: youPay,
    baseline_value: baseline,
    pay_unit: normalizeUnit(payUnit),
    credit_unit: normalizeUnit(creditUnit),
    units_comparable: false,
    effective_savings_pct: 0,
    bonus_pct,
    confidence: Math.min(0.4, Math.max(0, confidence)),
    source,
  };
}

/** Build deal_metrics when you_pay and baseline_value are known (you_pay < baseline for a “deal”). */
export function buildDealMetricsFromAmounts(
  youPay: number,
  baseline: number,
  mode: DealMetricsMode,
  confidence: number,
  source: DealMetricsSource,
  payUnit?: string,
  creditUnit?: string,
): DealMetrics | null {
  if (!(youPay > 0) || !(baseline > 0) || baseline <= youPay) return null;

  const payU = normalizeUnit(payUnit ?? "USD");
  const creditU = normalizeUnit(creditUnit ?? payU);

  if (!unitsAreComparable(payU, creditU)) {
    return buildIncomparableDealMetrics(youPay, baseline, mode, confidence, source, payU, creditU);
  }

  const effective_savings_pct = clampSavings(1 - youPay / baseline);
  const bonus_pct = clampBonus((baseline - youPay) / youPay);
  const value_ratio = baseline / youPay;
  return {
    mode,
    you_pay: youPay,
    baseline_value: baseline,
    pay_unit: payU,
    credit_unit: creditU,
    units_comparable: true,
    effective_savings_pct,
    bonus_pct,
    value_ratio,
    confidence: Math.min(1, Math.max(0, confidence)),
    source,
  };
}

const MONEY = "([\\d,]+(?:\\.\\d{1,2})?)";

const MULTI_TIER_OFFER_RE =
  /(\d[\d,]*)\s*(?:Gold\s*Coins?|GC)\s+for\s+\$(\d+(?:\.\d{1,2})?)(?:\s*\+\s*(\d+)\s*Free\s*(SC|FC)\b)?/gi;

function hasCreditToken(unitTokens: readonly string[], ...labels: string[]): boolean {
  const upper = new Set(unitTokens.map((t) => t.trim().toUpperCase()).filter(Boolean));
  return labels.some((l) => upper.has(l));
}

/** Heuristic: email lists multiple purchasable pay tiers (avoid cross-tier pairing). */
export function countDistinctOffers(text: string): number {
  const forPrices = [...text.matchAll(/\bfor\s+\$\s*[\d,]+(?:\.\d{1,2})?/gi)].length;
  const goldTier = [...text.matchAll(/\d[\d,]*\s*(?:Gold\s*Coins?|GC)\s+for\s+\$/gi)].length;
  return Math.max(forPrices, goldTier);
}

function extractForPrices(text: string): number[] {
  const prices: number[] = [];
  for (const m of text.matchAll(/\bfor\s+\$\s*([\d,]+(?:\.\d{1,2})?)/gi)) {
    const p = parseMoney(m[1]!);
    if (p != null) prices.push(p);
  }
  return prices;
}

function payMatchesListedTier(pay: number, text: string, tolerance = 0.05): boolean {
  const prices = extractForPrices(text);
  if (prices.length === 0) return true;
  return prices.some((p) => Math.abs(p - pay) / Math.max(p, pay) <= tolerance);
}

function payAndCreditNearEachOther(
  text: string,
  pay: number,
  credit: number,
  creditUnit: string,
): boolean {
  const payStr = pay.toFixed(2).replace(/\.?0+$/, "");
  const payPat = payStr.includes(".")
    ? payStr.replace(".", "\\.")
    : payStr;
  const re = new RegExp(
    `\\$\\s*${payPat}(?:\\s*\\+\\s*|[^$]{0,80}?)${credit}\\s*(?:Free\\s*)?${reEsc(creditUnit)}\\b`,
    "i",
  );
  return re.test(text);
}

function hasRetailListCue(text: string): boolean {
  return /\b(was|list\s*price|strike|retail|regular\s*price|originally)\b/i.test(text);
}

type PlausibilityOpts = { fromDollarEquals?: boolean };

/** Stakes, turnover and possible prizes are not the price/credit of a purchase. */
export function gameplayRewardNotPurchase(dm: DealMetrics, text: string): boolean {
  if (!/\b(?:prize\s+(?:drops?|pools?)|raffles?|leaderboards?|\d[\d,]*\s*XP|earn\s+XP|wager(?:ing)?|playthrough|turnover|daily\s+challenge|\d+\s+spins?\s+(?:at|of))\b/i.test(text)) return false;
  if (dm.you_pay == null || dm.baseline_value == null) return true;
  const pay = reEsc(String(dm.you_pay)) + (Number.isInteger(dm.you_pay) ? '(?:\\.00)?' : /^\d+\.\d$/.test(String(dm.you_pay)) ? '0?' : '');
  const credit = reEsc(String(dm.baseline_value));
  // A real package can include a raffle as an extra. Require its own explicit
  // purchase price and guaranteed credit; an unrelated footer's "buy" is insufficient.
  const price = `(?:\\$\\s*${pay}(?![\\d.])|\\b${pay}\\s*(?:USD|dollars?)\\b)`;
  const credited = `\\b${credit}(?:\\.0+)?\\s*(?:free\\s*)?${reEsc(dm.credit_unit ?? 'USD')}\\b`;
  return !text.split(/[\n.!?](?!\d)/).some(clause =>
    /\b(?:buy|purchase|package|bundle|deposit)\b/i.test(clause)
    && new RegExp(price, 'i').test(clause)
    && new RegExp(credited, 'i').test(clause)
    && !/\b(?:must\s+(?:play|wager)|wager(?:ing)?\s+requirement|chance\s+to\s+win|up\s+to|\d+\s+spins?\s+(?:at|of))\b/i.test(clause)
  );
}

/** Reject cross-tier or absurd pay/credit pairings. */
export function isPlausibleDealMetrics(
  dm: DealMetrics,
  text: string,
  opts?: PlausibilityOpts,
): boolean {
  const pay = dm.you_pay;
  const baseline = dm.baseline_value;
  if (pay == null || baseline == null || !(pay > 0) || !(baseline > 0)) return false;
  if (gameplayRewardNotPurchase(dm, text)) return false;
  // Counts of logins/days/spins are not a monetary purchase price.
  const amount = String(pay).replace('.', '\\.');
  if (new RegExp(`\\b${amount}\\s+(?:consecutive\\s+)?(?:days?|logins?|free\\s+plays?|spins?)\\b`, 'i').test(text)
    && !new RegExp(`(?:\\$\\s*${amount}\\b|\\b${amount}\\s*(?:USD|dollars?)\\b)`, 'i').test(text)) return false;

  const multiOffer = countDistinctOffers(text) >= 2;

  if (dm.units_comparable === false) {
    const bonus = dm.bonus_pct ?? 0;
    const creditUnit = (dm.credit_unit ?? "SC").toString();
    if (
      bonus > 0.6 &&
      !opts?.fromDollarEquals &&
      !payAndCreditNearEachOther(text, pay, baseline, creditUnit)
    ) {
      return false;
    }
    if (multiOffer && !payMatchesListedTier(pay, text)) return false;
    return true;
  }

  if (baseline / pay > 10 && !hasRetailListCue(text)) return false;
  if (multiOffer && !payMatchesListedTier(pay, text)) return false;
  return true;
}

function applyPlausibility(
  dm: DealMetrics | null,
  text: string,
  opts?: PlausibilityOpts,
): DealMetrics | null {
  if (!dm) return null;
  return isPlausibleDealMetrics(dm, text, opts) ? dm : null;
}

function dealDedupeKey(dm: DealMetrics): string {
  return `${dm.you_pay ?? ""}|${dm.baseline_value ?? ""}|${dm.pay_unit ?? ""}|${dm.credit_unit ?? ""}`;
}

function appendUniqueDeal(list: DealMetrics[], dm: DealMetrics | null, text: string): void {
  const plausible = applyPlausibility(dm, text);
  if (!plausible) return;
  const key = dealDedupeKey(plausible);
  if (list.some((d) => dealDedupeKey(d) === key)) return;
  list.push(plausible);
}

/** Parse all "40,000 Gold Coins for $15.49 + 20 Free SC" style tiers. */
function collectMultiTierCoinOffers(
  text: string,
  unitTokens: readonly string[],
): DealMetrics[] {
  if (!hasCreditToken(unitTokens, "SC", "FC")) return [];

  const allowedFree = new Set<string>();
  if (hasCreditToken(unitTokens, "SC")) allowedFree.add("SC");
  if (hasCreditToken(unitTokens, "FC")) allowedFree.add("FC");

  const deals: DealMetrics[] = [];

  for (const m of text.matchAll(MULTI_TIER_OFFER_RE)) {
    const freeUnit = (m[4] ?? "SC").toUpperCase();
    if (!allowedFree.has(freeUnit)) continue;
    const pay = parseMoney(m[2]!);
    const scRaw = m[3];
    if (pay == null || !scRaw) continue;
    const credited = parseMoney(scRaw);
    if (credited == null || credited <= pay) continue;

    appendUniqueDeal(
      deals,
      buildIncomparableDealMetrics(
        pay,
        credited,
        "pay_vs_credited_value",
        0.55,
        "regex",
        "USD",
        freeUnit,
      ),
      text,
    );
  }

  return deals;
}

/** Highest filterable strength deal in a list. */
export function pickBestDeal(deals: readonly DealMetrics[]): DealMetrics | null {
  let best: DealMetrics | null = null;
  let bestStrength = -1;
  for (const d of deals) {
    const s = dealStrengthPct(d);
    if (s > bestStrength) {
      bestStrength = s;
      best = d;
    }
  }
  return best;
}

/** "$50 = 75,000 GC + 75 FREE SC" style offers. */
function tryDollarEqualsFreeSc(text: string, unitTokens: readonly string[]): DealMetrics | null {
  if (!hasCreditToken(unitTokens, "SC", "FC")) return null;

  const allowedFree = new Set<string>();
  if (hasCreditToken(unitTokens, "SC")) allowedFree.add("SC");
  if (hasCreditToken(unitTokens, "FC")) allowedFree.add("FC");

  const re = new RegExp(
    `\\$\\s*${MONEY}\\s*=\\s*[\\s\\S]{0,120}?(\\d+)\\s*(?:FREE\\s*)?(SC|FC)\\b`,
    "gi",
  );
  let best: DealMetrics | null = null;
  let bestStrength = -1;
  for (const m of text.matchAll(re)) {
    const freeUnit = (m[3] ?? "SC").toUpperCase();
    if (!allowedFree.has(freeUnit)) continue;
    const pay = parseMoney(m[1]!);
    const credited = parseMoney(m[2]!);
    if (pay == null || credited == null || credited <= pay) continue;
    const candidate = buildIncomparableDealMetrics(
      pay,
      credited,
      "pay_vs_credited_value",
      0.55,
      "regex",
      "USD",
      freeUnit,
    );
    const strength = dealStrengthPct(candidate);
    if (strength > bestStrength) {
      bestStrength = strength;
      best = candidate;
    }
  }
  return best;
}

/** Single-offer regex paths (no multi-tier list). */
function extractSingleDealRegex(
  text: string,
  unitTokens: readonly string[],
): DealMetrics | null {
  const multiOffer = countDistinctOffers(text) >= 2;

  if (unitTokens.length > 0) {
    const fromEquals = tryDollarEqualsFreeSc(text, unitTokens);
    const plausibleEquals = applyPlausibility(fromEquals, text, { fromDollarEquals: !!fromEquals });
    if (plausibleEquals) return plausibleEquals;
  }

  if (!multiOffer && unitTokens.length > 0) {
    const fromPurchase = tryPurchasePackageUsdToToken(text, unitTokens);
    const plausible = applyPlausibility(fromPurchase, text);
    if (plausible) return plausible;
  }

  const suf = buildUnitSuffixPattern(unitTokens);
  if (suf && !multiOffer) {
    const creditLabel = primaryCreditUnitLabel(unitTokens);
    const fromUnits = tryUnitPair(text, suf, creditLabel, 0.52);
    const plausible = applyPlausibility(fromUnits, text);
    if (plausible) return plausible;
  }

  const wasNow = new RegExp(
    `was\\s*\\$?${MONEY}\\b[\\s\\S]{0,120}?(?:now|only|just|from)\\s*\\$?${MONEY}\\b`,
    "i",
  );
  let m = wasNow.exec(text);
  if (m) {
    const high = parseMoney(m[1]!);
    const low = parseMoney(m[2]!);
    if (high != null && low != null && high > low) {
      return applyPlausibility(
        buildDealMetricsFromAmounts(low, high, "retail_list_vs_sale", 0.55, "regex", "USD", "USD"),
        text,
      );
    }
  }

  if (!multiOffer) {
    const getFor = new RegExp(
      `\\b(?:get|receive|worth|value(?:\\s+of)?)\\s*\\$?${MONEY}\\b[\\s\\S]{0,80}?(?:for|only|just)\\s*\\$?${MONEY}\\b`,
      "i",
    );
    m = getFor.exec(text);
    if (m) {
      const credited = parseMoney(m[1]!);
      const pay = parseMoney(m[2]!);
      if (credited != null && pay != null && credited > pay) {
        const dm = buildDealMetricsFromAmounts(
          pay,
          credited,
          "pay_vs_credited_value",
          0.5,
          "regex",
          "USD",
          "USD",
        );
        const plausible = applyPlausibility(dm, text);
        if (plausible) return plausible;
      }
    }

    const forOnlyGet = new RegExp(
      `\\b(?:for|only|just)\\s*\\$?${MONEY}\\b[\\s\\S]{0,100}?(?:get|receive|worth)\\s*\\$?${MONEY}\\b`,
      "i",
    );
    m = forOnlyGet.exec(text);
    if (m) {
      const pay = parseMoney(m[1]!);
      const credited = parseMoney(m[2]!);
      if (pay != null && credited != null && credited > pay) {
        const dm = buildDealMetricsFromAmounts(
          pay,
          credited,
          "pay_vs_credited_value",
          0.45,
          "regex",
          "USD",
          "USD",
        );
        const plausible = applyPlausibility(dm, text);
        if (plausible) return plausible;
      }
    }

    const payGet = new RegExp(
      `\\b(?:pay|buy|deposit)\\s*\\$?${MONEY}\\b[\\s\\S]{0,100}?(?:get|receive|worth)\\s*\\$?${MONEY}\\b`,
      "i",
    );
    m = payGet.exec(text);
    if (m) {
      const pay = parseMoney(m[1]!);
      const credited = parseMoney(m[2]!);
      if (pay != null && credited != null && credited > pay) {
        const dm = buildDealMetricsFromAmounts(
          pay,
          credited,
          "pay_vs_credited_value",
          0.55,
          "regex",
          "USD",
          "USD",
        );
        const plausible = applyPlausibility(dm, text);
        if (plausible) return plausible;
      }
    }
  }

  return null;
}

/**
 * All plausible deals extracted from subject + body (multi-tier + single-offer paths).
 */
export function extractDealsFoundRegex(
  subject: string,
  body: string,
  unitTokens: readonly string[] = [],
): DealMetrics[] {
  const text = `${subject}\n${body}`.replace(/\s+/g, " ");
  const deals: DealMetrics[] = [];

  if (unitTokens.length > 0) {
    for (const d of collectMultiTierCoinOffers(text, unitTokens)) {
      appendUniqueDeal(deals, d, text);
    }
  }

  if (deals.length === 0) {
    appendUniqueDeal(deals, extractSingleDealRegex(text, unitTokens), text);
  }

  return deals;
}

function tryUnitPair(
  text: string,
  suf: string,
  creditUnitLabel: string,
  confidence: number,
): DealMetrics | null {
  const NUM_SUF = `${MONEY}\\s*${suf}\\b`;
  const payDollar = `(?:\\$)?${MONEY}\\b`;

  const getFor = new RegExp(
    `\\b(?:get|receive|worth|value(?:\\s+of)?)\\s*${NUM_SUF}[\\s\\S]{0,100}?(?:for|only|just)\\s*${payDollar}`,
    "i",
  );
  let m = getFor.exec(text);
  if (m) {
    const credited = parseMoney(m[1]!);
    const pay = parseMoney(m[2]!);
    if (credited != null && pay != null && credited > pay) {
      return buildIncomparableDealMetrics(
        pay,
        credited,
        "pay_vs_credited_value",
        confidence,
        "regex",
        "USD",
        creditUnitLabel,
      );
    }
  }

  const forGet = new RegExp(
    `\\b(?:for|only|just)\\s*${payDollar}[\\s\\S]{0,120}?(?:get|receive|worth)\\s*${NUM_SUF}`,
    "i",
  );
  m = forGet.exec(text);
  if (m) {
    const pay = parseMoney(m[1]!);
    const credited = parseMoney(m[2]!);
    if (pay != null && credited != null && credited > pay) {
      return buildIncomparableDealMetrics(
        pay,
        credited,
        "pay_vs_credited_value",
        confidence - 0.05,
        "regex",
        "USD",
        creditUnitLabel,
      );
    }
  }

  const payGet = new RegExp(
    `\\b(?:pay|buy|deposit)\\s*${payDollar}[\\s\\S]{0,120}?(?:get|receive|worth)\\s*${NUM_SUF}`,
    "i",
  );
  m = payGet.exec(text);
  if (m) {
    const pay = parseMoney(m[1]!);
    const credited = parseMoney(m[2]!);
    if (pay != null && credited != null && credited > pay) {
      return buildIncomparableDealMetrics(
        pay,
        credited,
        "pay_vs_credited_value",
        confidence,
        "regex",
        "USD",
        creditUnitLabel,
      );
    }
  }

  return null;
}

/** First non-$ unit token label for cross-unit regex (e.g. SC). */
function primaryCreditUnitLabel(unitTokens: readonly string[]): string {
  const t = unitTokens.map((x) => x.trim()).find((x) => x.length > 0 && x !== "$");
  return t ?? "TOKEN";
}

/** Best deal from regex/heuristics (used for merge + min-deal filter). */
export function extractDealMetricsRegex(
  subject: string,
  body: string,
  unitTokens: readonly string[] = [],
): DealMetrics | null {
  return pickBestDeal(extractDealsFoundRegex(subject, body, unitTokens));
}

function dealFromLlmPartial(p: DealMetricsLlmPartial, source: DealMetricsSource): DealMetrics | null {
  const y = p.you_pay;
  const b = p.baseline_value;
  if (y == null || b == null) return null;
  return buildDealMetricsFromAmounts(
    y,
    b,
    p.mode ?? "unknown",
    p.confidence,
    source,
    p.pay_unit ?? undefined,
    p.credit_unit ?? undefined,
  );
}

/**
 * Prefer LLM when it returns a valid pair with decent confidence; otherwise regex; merge when both agree roughly.
 */
export function mergeDealExtractions(
  llm: DealMetricsLlmPartial | null,
  regex: DealMetrics | null,
  sourceText = "",
): DealMetrics | undefined {
  const text = sourceText.replace(/\s+/g, " ");
  const validatedRegex = applyPlausibility(regex, text);

  if (validatedRegex?.units_comparable === false) {
    return validatedRegex;
  }

  const fromLlmRaw = llm ? dealFromLlmPartial(llm, "llm") : null;
  const fromLlm = applyPlausibility(fromLlmRaw, text);

  if (fromLlm?.units_comparable === false) {
    return fromLlm;
  }

  if (fromLlm && (llm!.confidence >= 0.45 || !validatedRegex)) {
    if (validatedRegex && fromLlm.units_comparable && fromLlm.effective_savings_pct > 0) {
      const agree =
        fromLlm.you_pay != null &&
        validatedRegex.you_pay != null &&
        fromLlm.baseline_value != null &&
        validatedRegex.baseline_value != null &&
        Math.abs(fromLlm.you_pay - validatedRegex.you_pay) /
          Math.max(fromLlm.you_pay, validatedRegex.you_pay) <
          0.15 &&
        Math.abs(fromLlm.baseline_value - validatedRegex.baseline_value) /
          Math.max(fromLlm.baseline_value, validatedRegex.baseline_value) <
          0.15;
      if (agree) {
        return {
          ...fromLlm,
          confidence: Math.min(1, (fromLlm.confidence + validatedRegex.confidence) / 2 + 0.1),
          source: "merged",
        };
      }
    }
    return fromLlm;
  }
  if (validatedRegex) return validatedRegex;
  if (fromLlm) return fromLlm;
  return undefined;
}

/** Max filterable deal strength (for tests and sorting helpers). */
export function dealStrengthPct(dm: DealMetrics): number {
  const savings = dm.units_comparable === false ? 0 : (dm.effective_savings_pct ?? 0);
  const bonus = dm.bonus_pct ?? 0;
  return Math.max(savings, bonus);
}

function extractTokenCreditAmount(text: string, token: string): number | null {
  const suf = reEsc(token);
  const freeBefore = new RegExp(`(${MONEY})\\s+FREE\\s*${suf}\\b`, "i").exec(text);
  if (freeBefore) return parseMoney(freeBefore[1]!);
  const freeAfter = new RegExp(`FREE\\s+(${MONEY})\\s*${suf}\\b`, "i").exec(text);
  if (freeAfter) return parseMoney(freeAfter[1]!);
  const matches = [...text.matchAll(new RegExp(`(${MONEY})\\s*${suf}\\b`, "gi"))];
  if (matches.length === 0) return null;
  return parseMoney(matches[matches.length - 1]![1]!);
}

/** purchase $20 package ... receive 26 FREE SC (USD pay, token credit). */
function tryPurchasePackageUsdToToken(
  text: string,
  unitTokens: readonly string[],
): DealMetrics | null {
  const payM =
    /\$\s*([\d,]+(?:\.\d{1,2})?)\s+package\b/i.exec(text) ??
    /\b(?:purchase|buy)\b[\s\S]{0,120}?\$\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  if (!payM) return null;
  const pay = parseMoney(payM[1]!);
  if (pay == null) return null;

  const ordered = [...unitTokens].sort((a, b) => {
    const au = a.trim().toUpperCase();
    const bu = b.trim().toUpperCase();
    if (au === "SC") return -1;
    if (bu === "SC") return 1;
    if (au === "FC") return -1;
    if (bu === "FC") return 1;
    return 0;
  });

  let best: DealMetrics | null = null;
  for (const raw of ordered) {
    const token = raw.trim();
    if (!token || token === "$") continue;
    const credited = extractTokenCreditAmount(text, token);
    if (credited == null || credited <= pay) continue;
    const candidate = buildIncomparableDealMetrics(
      pay,
      credited,
      "pay_vs_credited_value",
      0.5,
      "regex",
      "USD",
      token,
    );
    if (credited > pay * 50) continue;
    if (!best || (best.baseline_value ?? 0) > credited) {
      best = candidate;
    }
  }
  return best;
}
