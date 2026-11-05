import type { JobDesign, JobField } from '../schema';

export const signatureQualificationFields: JobField[] = [
  { key: 'team_size', label: 'Team size', type: 'number', required: true, description: 'Integer 1–25 indicated by the quoted primary evidence. Solo founders qualify.' },
  { key: 'team_source', label: 'Team source', type: 'url', required: true, description: 'Exact official page URL, also included in sources.' },
  { key: 'team_quote', label: 'Team evidence quote', type: 'long_text', required: true, description: 'Verbatim 10–1000 character passage showing the company is this small, such as a founder running it alone, a stated team size or a team page listing.' },
  { key: 'growth_source', label: 'Growth source', type: 'url', required: true, description: 'Exact official announcement URL, also included in sources.' },
  { key: 'growth_quote', label: 'Growth evidence quote', type: 'long_text', required: true, description: 'Verbatim 30–1000 character announcement of hiring, funding, expansion or launch.' },
  { key: 'growth_date', label: 'Growth announcement date', type: 'date', required: true, description: 'YYYY-MM-DD, from the last year, supported by the announcement.' },
];

export function upgradeSignatureFields(design: JobDesign): JobDesign {
  if (design.skill !== 'signature_outreach') return design;
  const keys = new Set(signatureQualificationFields.map(field => field.key));
  return { ...design, fields: [...design.fields.filter(field => field.key !== 'phone' && !keys.has(field.key)), ...signatureQualificationFields] };
}

const fields = {
  company: 'Prospect', website: 'Official website', team_evidence: 'Team size and source', growth_evidence: 'Recent growth and date',
  first_name: 'First name', last_name: 'Last name', role: 'Published role', email: 'Published work email', contact_source: 'Contact source', feed: 'Official blog feed', person_source: 'Team member source',
  logo: 'Official logo', primary_color: 'Primary color', secondary_color: 'Accent color', social: 'Company Bluesky profile',
  preset: 'Tailnote layout', cta_type: 'CTA block', cta_label: 'CTA text', cta_url: 'CTA destination', post: 'Social post',
};
export function signatureOutreachDesign(): JobDesign {
  return {
    skill: 'signature_outreach', title: 'Tailnote signature spotlight', category: 'marketing', recordsPerRun: 1,
    instructions: `Scout one new small growing company. Any size from a solo founder up to 25 people qualifies. Check earlier results and skip repeat companies. Cite the company's team page and a recent dated hiring, funding, expansion or launch announcement. Explain team size with uncertainty and growth with a date. Verify a named person's role from their official site and a company Bluesky profile linked from that site. Use the actual profile URL, direct high-resolution brand logo URL, two accurate brand hex colors and official CTA destination. Include the exact CTA, contact and team page URLs in record.sources. Prioritize prospects with active official blogs. For the usual blog showcase require an RSS or Atom feed linked to the company blog. For an alternate CTA showcase the feed is optional. Always require a publicly listed work email (company contact email is fine), and a cited contact page. Exclude all phone numbers from the signature. The hero promo is the dynamic latest-blog block populated from their actual feed. On alternate runs describe the CTA actually shown. Use a complementary CTA that serves the business. Skip a prospect that cannot supply the required branding, contact information or (for a blog showcase) a blog. Choose the best Tailnote layout (portfolio, creator, modern_professional). Choose a book_a_call block for a real appointment page or list block for an offering, release or resource. Vary the layout and CTA according to the brand. Write a concise Bluesky draft as Tailnote, tagging the verified company handle. We never email prospects: the only outreach is a public post from Tailnote with the rendered signature attached, tagging the company so they notice it and reply. Write the post to start a conversation about their business: open with something specific and true from their own site, such as the growth announcement, and ask a genuine question they would want to answer. Say plainly that this is a signature concept we made for them unprompted, not something they asked for or use. For a blog showcase, mention that it features their latest article. Leave out tailnote.io and every other link: the post comes from the Tailnote account, and the link can wait until they reply. The only picture is the rendered signature. No hard sell. Because this is public, never state their team size or anything you have not verified. Use at most 300 characters for Bluesky. Do not invent contact details, endorsements, growth evidence or handles. Return one record only if all evidence exists. Nucleas renders and photographs the concept after research.`,
    fields: [...signatureQualificationFields, ...Object.entries(fields).map(([key,label]) => ({ key, label, type: ['website','person_source','logo','social','cta_url'].includes(key) ? 'url' : 'text', required: key !== 'feed', description: '' } as JobField))],
    sourcePolicy: 'Open and cite primary sources for the person, team size, growth, brand and public social account. Use only published professional details.',
    delivery: { method: 'nucleas', detail: 'Review the signature screenshot and tagged post together. Nothing is emailed to the prospect.', setupSteps: [] },
    schedule: { kind: 'weekly', weekdays: [1, 3, 5], time: '09:00', timezone: 'America/Chicago' },
    recommendedCompletion: 'review', safeguards: ['One prospect per run.', 'Review tagged outreach before sharing.'], findings: [], questions: [],
  };
}
