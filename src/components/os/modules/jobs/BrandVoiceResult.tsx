import { brandProfileSchema } from '@/lib/brandVoice/profile';

export default function BrandVoiceResult({ value }: { value: unknown }) {
  let raw = value;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return <p className="whitespace-pre-wrap">{String(raw)}</p>; } }
  const parsed = brandProfileSchema.safeParse(raw);
  if (!parsed.success) return <p className="text-amber-300">This profile could not be displayed. Review the validation issues before accepting it.</p>;
  const p = parsed.data;
  const sections: [string, string[]][] = [
    ['Positioning', [p.positioning.primary, p.positioning.secondary ?? '']],
    ['Audience relationship', [p.audienceRelationship.style]],
    ['Tone and emotion', [p.emotionalBaseline.primary, p.emotionalBaseline.secondary ?? '']],
    ['Personality traits', [p.contradictions.primaryTrait, p.contradictions.secondaryTrait]],
    ['Sounds like', p.contrastive.soundsLike], ['Does not sound like', p.contrastive.doesNotSoundLike],
    ['Writing patterns', p.rhetoricalPatterns], ['Avoid', p.taboos], ['Content objectives', p.contentObjectives],
    ['Archetype', [p.archetype]],
    ['Shared identity', [p.sharedIdentity.audienceType, p.sharedIdentity.internetCultureAlignment, p.sharedIdentity.sophisticationLevel, p.sharedIdentity.energyProfile, p.sharedIdentity.trustStyle]],
    ['Favorite phrases', p.memory.favoritePhrases], ['Recurring topics', p.memory.recurringTopics],
    ['Recurring jokes', p.memory.recurringJokes], ['Calls to action', p.memory.recurringCTAs], ['Opposes', p.memory.recurringEnemies],
  ];
  return <div className="space-y-4">{sections.filter(([, items]) => items.some(Boolean)).map(([title, items]) => <section key={title}>
    <h4 className="font-semibold text-text-primary">{title}</h4>
    <ul className="list-disc pl-5 space-y-1">{items.filter(Boolean).map((item, i) => <li key={i} className="whitespace-pre-wrap break-words">{item}</li>)}</ul>
  </section>)}</div>;
}
