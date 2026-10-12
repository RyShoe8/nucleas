import { describe, expect, it } from 'vitest';
import { analyzeGenericity, detectPerson, enforceTaboos, extractStyleKit, fidelityRetryIssues, findAiPhrases, measureStyle, scoreFidelity, styleRulesFromProfile } from './style';

const BRAND = `# Free spins, explained

We test every bonus ourselves. We never recommend one we would not take.

Most welcome offers hide the catch in the wagering terms. We read them so you do not have to.

# What we look for

A 35x playthrough on $50 is $1,750 of play. That is the real price. We say so.

We keep it short. We keep it honest. Then we show the math.

No fluff.`;

const MACHINE = `# Understanding Casino Bonuses

In today's fast-paced world, it's worth noting that casino bonuses are a game-changing way to maximize your fun. Players can leverage a plethora of offers to unlock rewards across a robust landscape of platforms and operators who compete for attention.

- Offer one
- Offer two
- Offer three
- Offer four

# Key Takeaways

In conclusion, you should not just claim bonuses, but also read the terms carefully before you embark on this journey today and beyond.`;

describe('style measurement', () => {
  it('measures person, headings and rhythm from samples', () => {
    const p = measureStyle([BRAND]);
    expect(p.sampleCount).toBe(1);
    expect(p.person).toBe('first_plural');
    expect(p.headingStyle).toBe('punchy');
    expect(p.shortParagraphShare).toBeGreaterThan(0);
    expect(p.usesFragments).toBe(true);
  });

  it('returns an unmeasured profile for thin input', () => {
    expect(measureStyle(['too short']).sampleCount).toBe(0);
    expect(scoreFidelity('anything', measureStyle([])).measured).toBe(false);
  });

  it('detects person only on a real signal', () => {
    expect(detectPerson('The report covers the market. '.repeat(10))).toBe('third');
    expect(detectPerson('You should check your bonus terms before you play and your balance. '.repeat(4))).toBe('second');
  });
});

describe('fidelity', () => {
  const target = measureStyle([BRAND]);
  it('scores the brand’s own writing higher than machine text', () => {
    const own = scoreFidelity(BRAND, target);
    const machine = scoreFidelity(MACHINE, target);
    expect(own.measured).toBe(true);
    expect(own.score).toBeGreaterThan(machine.score);
    expect(own.score).toBeGreaterThanOrEqual(85);
  });

  it('turns weak components into retry instructions', () => {
    const result = scoreFidelity(MACHINE, target);
    const issues = fidelityRetryIssues(result, 90);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(' ')).toMatch(/first-person plural/);
    expect(fidelityRetryIssues(scoreFidelity(BRAND, target), 10)).toEqual([]);
  });

  it('builds prompt rules from the measurement', () => {
    const rules = styleRulesFromProfile(target).join('\n');
    expect(rules).toMatch(/first-person plural/);
    expect(rules).toMatch(/prose/);
    expect(styleRulesFromProfile(measureStyle([]))).toEqual([]);
  });
});

describe('machine-writing detection', () => {
  it('flags stock phrases and tics', () => {
    expect(findAiPhrases('In conclusion, dive in and leverage it.')).toEqual(expect.arrayContaining(['in conclusion', 'dive in', 'leverage']));
    expect(findAiPhrases('A long journey home.')).toEqual([]);
    const g = analyzeGenericity(MACHINE);
    expect(g.score).toBeGreaterThan(40);
    expect(g.issues.length).toBeGreaterThan(2);
    expect(analyzeGenericity(BRAND).score).toBeLessThan(20);
  });

  it('penalises dashes and emoji, and removes them', () => {
    const text = 'We tried it — it worked 😀 well.';
    expect(analyzeGenericity(text).issues.join(' ')).toMatch(/dash/i);
    const cleaned = enforceTaboos(text);
    expect(cleaned).not.toMatch(/[–—]/);
    expect(cleaned).not.toMatch(/\uD83D/);
    expect(cleaned).toContain('We tried it, it worked');
  });
});

describe('style kit', () => {
  it('collects openings, signature paragraphs and concrete details', () => {
    const kit = extractStyleKit([BRAND]);
    expect(kit.openings[0]).toMatch(/We test every bonus/);
    expect(kit.signatures.length).toBeGreaterThan(0);
    expect(kit.details.join(' ')).toMatch(/\$1,750/);
  });
});
