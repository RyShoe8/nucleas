import type { JobDesign } from '../schema';

const fields = {
  company: 'Prospect', website: 'Official website', team_evidence: 'Team size and source', growth_evidence: 'Recent growth and date',
  first_name: 'First name', last_name: 'Last name', role: 'Published role', email: 'Published work email', phone: 'Published office phone (if available)', contact_source: 'Contact source', feed: 'Official blog feed', person_source: 'Team member source',
  logo: 'Official logo', primary_color: 'Primary color', secondary_color: 'Accent color', social: 'Company social profile',
  preset: 'Tailnote layout', cta_type: 'CTA block', cta_label: 'CTA text', cta_url: 'CTA destination', post: 'Social post',
};
export function signatureOutreachDesign(): JobDesign {
  return {
    skill: 'signature_outreach', title: 'Tailnote signature spotlight', category: 'marketing', recordsPerRun: 1,
    instructions: `Scout one new small growing company. Prefer fewer than 15 people, allow slightly larger teams with strong evidence. Check earlier results and skip repeat companies. Cite the company's team page and a recent dated hiring, funding, expansion or launch announcement. Explain team size with uncertainty and growth with a date. Verify a named person's role from their official site and a company Bluesky or Facebook profile linked from that site. Use the actual profile URL, direct high-resolution brand logo URL, two accurate brand hex colors and official CTA destination. Include the exact CTA, contact and team page URLs in record.sources. Prioritize prospects with active official blogs. For the usual blog showcase require an RSS or Atom feed linked to the company blog. For an alternate CTA showcase the feed is optional. Always require a publicly listed work email (company contact email is fine), and a cited contact page. Include a published business phone when available. The hero promo is the dynamic latest-blog block populated from their actual feed. When showing a blog, explain in the draft that the signature can feature their latest article as they publish. On alternate runs describe the CTA actually shown. Use a complementary CTA that serves the business. Skip a prospect that cannot supply the required branding, contact information or (for a blog showcase) a blog. Choose the best Tailnote layout (portfolio, creator, modern_professional). Choose a book_a_call block for a real appointment page or list block for an offering, release or resource. Vary the layout and CTA according to the brand. Write a concise platform-specific social draft as Tailnote, explicitly describing the signature as an unsolicited design concept, tagging the verified company handle and inviting them to try https://tailnote.io. Use at most 300 characters for Bluesky. Do not invent contact details, endorsements, growth evidence or handles. Return one record only if all evidence exists. Nucleas renders and photographs the concept after research.`,
    fields: Object.entries(fields).map(([key,label]) => ({ key, label, type: ['website','person_source','logo','social','cta_url'].includes(key) ? 'url' : 'text', required: key !== 'phone' && key !== 'feed', description: '' })),
    sourcePolicy: 'Open and cite primary sources for the person, team size, growth, brand and public social account. Use only published professional details.',
    delivery: { method: 'nucleas', detail: 'Review the signature screenshot and tagged post together.', setupSteps: [] },
    schedule: { kind: 'weekly', weekdays: [1, 3, 5], time: '09:00', timezone: 'America/Chicago' },
    recommendedCompletion: 'review', safeguards: ['One prospect per run.', 'Review tagged outreach before sharing.'], findings: [], questions: [],
  };
}
