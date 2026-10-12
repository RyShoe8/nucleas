import { describe, expect, it } from "vitest";
import {
  buildDealMetricsFromAmounts,
  countDistinctOffers,
  dealStrengthPct,
  extractDealMetricsRegex,
  extractDealsFoundRegex,
} from "./dealMetrics";

describe("buildDealMetricsFromAmounts", () => {
  it("computes bonus and savings for same-unit USD ($20 pay, $26 credited)", () => {
    const dm = buildDealMetricsFromAmounts(20, 26, "pay_vs_credited_value", 0.5, "regex", "USD", "USD")!;
    expect(dm).toBeTruthy();
    expect(dm.units_comparable).toBe(true);
    expect(Math.abs(dm.effective_savings_pct - (1 - 20 / 26)) < 0.01).toBeTruthy();
    expect(Math.abs(dm.bonus_pct! - (26 - 20) / 20) < 0.01).toBeTruthy();
    expect(dealStrengthPct(dm) < 0.75).toBeTruthy();
  });

  it("marks USD pay vs SC credit as incomparable but stores bonus for filters", () => {
    const dm = buildDealMetricsFromAmounts(20, 26, "pay_vs_credited_value", 0.5, "regex", "USD", "SC")!;
    expect(dm).toBeTruthy();
    expect(dm.units_comparable).toBe(false);
    expect(dm.effective_savings_pct).toBe(0);
    expect(Math.abs(dm.bonus_pct! - 0.3) < 0.02).toBeTruthy();
    expect(dealStrengthPct(dm) >= 0.25).toBeTruthy();
  });

  it("retail was $100 now $25 is 75% off", () => {
    const dm = buildDealMetricsFromAmounts(25, 100, "retail_list_vs_sale", 0.55, "regex", "USD", "USD")!;
    expect(dm).toBeTruthy();
    expect(Math.abs(dm.effective_savings_pct - 0.75) < 0.01).toBeTruthy();
    expect(dealStrengthPct(dm) >= 0.75).toBeTruthy();
  });
});

describe("countDistinctOffers", () => {
  it("does not treat duplicate FREE SC in subject and body as multi-offer", () => {
    const subject = "Claim 75 FREE SC!";
    const body = "$50 = 75,000 GC + 75 FREE SC. purchase the special $50 package.";
    expect(countDistinctOffers(`${subject}\n${body}`) < 2).toBeTruthy();
  });
});

describe("extractDealMetricsRegex", () => {
  it("Spinfinite Thursday Treat: $20 = 26 FREE SC", () => {
    const subject = "Mega Offer Ends Soon — 26 FREE SC";
    const body =
      "For a limited time, grab this boosted package: $20 = 26,000 GC + 26 FREE SC + Cosmic Wheel Spin. purchase via our special $20 package labelled Thursday Treat.";
    const dm = extractDealMetricsRegex(subject, body, ["SC", "GC"])!;
    expect(dm).toBeTruthy();
    expect(dm.you_pay).toBe(20);
    expect(dm.baseline_value).toBe(26);
    expect(dealStrengthPct(dm) >= 0.25).toBeTruthy();
  });

  it("Spinfinite: $50 = 75 FREE SC with subject Claim 75 FREE SC", () => {
    const subject = "Time's Running Out — Claim 75 FREE SC!";
    const body =
      "We've unlocked a limited-time boost. $50 = 75,000 GC + 75 FREE SC + a Ruby Wheel Spin. purchase via our special $50 package labelled Thursday Night Spins.";
    const dm = extractDealMetricsRegex(subject, body, ["SC", "GC"])!;
    expect(dm).toBeTruthy();
    expect(dm.you_pay).toBe(50);
    expect(dm.baseline_value).toBe(75);
    expect(dealStrengthPct(dm) >= 0.45).toBeTruthy();
  });

  it("Spinfinite Prime+: $44 = 44,000 GC + 1,000 Stars + 150 SC (no FREE on bundle line)", () => {
    const subject = "Unlock Prime+ Today for 150 FREE SC!";
    const body =
      "Your Prime+ access is here! Lock in 150 FREE SC over the next 30 days. $44 = 44,000 GC + 1,000 Stars + 150 SC Tap in and start your streak PURCHASE NOW";
    const dm = extractDealMetricsRegex(subject, body, ["SC", "GC"])!;
    expect(dm).toBeTruthy();
    expect(dm.you_pay).toBe(44);
    expect(dm.baseline_value).toBe(150);
    expect(dm.units_comparable).toBe(false);
    expect(dealStrengthPct(dm) >= 0.25).toBeTruthy();
    const deals = extractDealsFoundRegex(subject, body, ["SC", "GC"]);
    expect(deals.length >= 1).toBeTruthy();
  });

  it("Spinfinite Prime+ full email copy with emoji and Terms and Conditions", () => {
    const subject = "Unlock Prime+ Today for 150 FREE SC!";
    const body =
      "Your Prime+ access is here! Lock in 150 FREE SC over the next 30 days 💰 $44 = 44,000 GC + 1,000 Stars + 150 SC Tap in and start your streak PURCHASE NOW Terms and Conditions: * Following purchase you will receive Gold Coins and an initial amount of free SC * The remaining free SC is credited over the course of the 30-day pass period.";
    const dm = extractDealMetricsRegex(subject, body, ["SC", "GC"])!;
    expect(dm).toBeTruthy();
    expect(dm.you_pay).toBe(44);
    expect(dm.baseline_value).toBe(150);
    const deals = extractDealsFoundRegex(subject, body, ["SC", "GC"]);
    expect(deals.length >= 1).toBeTruthy();
  });

  it("deposit $20 get 26 SC has ~30% filterable bonus", () => {
    const dm = extractDealMetricsRegex(
      "Deposit $20 and get 26 SC free",
      "",
      ["SC"],
    )!;
    expect(dm).toBeTruthy();
    expect(dm.units_comparable).toBe(false);
    expect(dealStrengthPct(dm) >= 0.25).toBeTruthy();
  });

  it("purchase $20 package receive 26 FREE SC (Thursday Treat copy)", () => {
    const dm = extractDealMetricsRegex(
      "purchase the special $20 package labeled Thursday Treat to receive 26,000 GC, 26 FREE SC",
      "",
      ["SC", "GC"],
    )!;
    expect(dm).toBeTruthy();
    expect(dm.you_pay).toBe(20);
    expect(dm.baseline_value).toBe(26);
    expect(dealStrengthPct(dm) >= 0.25).toBeTruthy();
  });

  it("pay $20 get $26 USD is comparable with ~30% bonus", () => {
    const dm = extractDealMetricsRegex("Pay $20 and get $26 in bonus credits", "", [])!;
    expect(dm).toBeTruthy();
    expect(dm.units_comparable).toBe(true);
    expect(Math.abs(dm.bonus_pct! - 0.3) < 0.02).toBeTruthy();
    expect(dealStrengthPct(dm) < 0.75).toBeTruthy();
  });

  it("was $100 now $25 passes 75% strength", () => {
    const dm = extractDealMetricsRegex("Was $100 now only $25", "", [])!;
    expect(dm).toBeTruthy();
    expect(dm.mode).toBe("retail_list_vs_sale");
    expect(dealStrengthPct(dm) >= 0.75).toBeTruthy();
  });

  it("Mega Bonanza multi-tier: extractDealsFoundRegex returns 3 tiers", () => {
    const body =
      "Take advantage of the Sizzlin' Stampede with three hot offers on Gold Coins, each claimable three times: 40,000 Gold Coins for $15.49 + 20 Free SC, 64,000 Gold Coins for $24.99 + 32 Free SC, and 90,000 Gold Coins for $34.99 + 45 Free SC. These offers are valid until May 22nd.";
    const deals = extractDealsFoundRegex("Somethin' hot just rode into town", body, ["SC", "GC"]);
    expect(deals.length).toBe(3);
    const pairs = deals.map((d) => [d.you_pay, d.baseline_value] as const);
    expect(pairs.some(([p, s]) => p === 15.49 && s === 20)).toBeTruthy();
    expect(pairs.some(([p, s]) => p === 24.99 && s === 32)).toBeTruthy();
    expect(pairs.some(([p, s]) => p === 34.99 && s === 45)).toBeTruthy();
    const best = deals.reduce((a, b) => (dealStrengthPct(b) > dealStrengthPct(a) ? b : a));
    const bestStrength = dealStrengthPct(best);
    expect(bestStrength >= 0.25).toBeTruthy();
    expect(bestStrength <= 0.4).toBeTruthy();
  });

  it("Mega Bonanza multi-tier: ~30% not 99% from cross-tier pairing", () => {
    const body =
      "Take advantage of the Sizzlin' Stampede with three hot offers on Gold Coins, each claimable three times: 40,000 Gold Coins for $15.49 + 20 Free SC, 64,000 Gold Coins for $24.99 + 32 Free SC, and 90,000 Gold Coins for $34.99 + 45 Free SC. These offers are valid until May 22nd.";
    const dm = extractDealMetricsRegex("Somethin' hot just rode into town", body, ["SC", "GC"])!;
    expect(dm).toBeTruthy();
    const strength = dealStrengthPct(dm);
    expect(strength >= 0.25).toBeTruthy();
    expect(strength <= 0.4).toBeTruthy();
    expect(dm.units_comparable).toBe(false);
    expect(dm.you_pay != null && dm.baseline_value != null).toBeTruthy();
    const tierPairs: [number, number][] = [
      [15.49, 20],
      [24.99, 32],
      [34.99, 45],
    ];
    expect(
      tierPairs.some(([pay, sc]) => dm.you_pay === pay && dm.baseline_value === sc),
      `pay/sc should be one tier, got ${dm.you_pay}/${dm.baseline_value}`,
    ).toBeTruthy();
  });
});

describe("dealStrengthPct filter threshold", () => {
  it("excludes $20/$26 USD from 75% min", () => {
    const dm = buildDealMetricsFromAmounts(20, 26, "pay_vs_credited_value", 0.5, "regex", "USD", "USD")!;
    expect(dealStrengthPct(dm) < 0.75).toBeTruthy();
  });

  it("includes retail 75% off at 75% min", () => {
    const dm = buildDealMetricsFromAmounts(25, 100, "retail_list_vs_sale", 0.55, "regex", "USD", "USD")!;
    expect(dealStrengthPct(dm) >= 0.75).toBeTruthy();
  });
});
