import 'server-only';
import { randomBytes } from 'crypto';
import type { Types } from 'mongoose';
import { Job } from '@/lib/models/Job';
import { PublishDelivery, PublishItem } from '@/lib/models/Publishing';
import { publishingConfigSchema } from './config';
import { readConfig } from './engine';
import { notifyPeople } from './notify';

const LANDING = 'https://tailnote.io/signature-example';
const TOKEN = /^[a-f0-9]{32}$/;

type SignatureJob = { _id: Types.ObjectId; organizationId: Types.ObjectId; companyId: Types.ObjectId; createdByUserId: Types.ObjectId; publishing?: unknown };

/** Puts a finished signature concept on the review cards, with its own landing page. Posting is a person's decision. */
export async function queueSignaturePost(job: SignatureJob, values: Record<string, unknown>): Promise<void> {
  const read = (key: string) => String(values[key] ?? '').trim();
  const company = read('company');
  const post = read('post');
  const imageUrl = read('screenshot');
  const domain = read('prospect_domain');
  if (!company || !post || !imageUrl || !domain) throw new Error('The signature concept is missing its company, post, picture or website.');
  const platform = new URL(read('social')).hostname === 'bsky.app' ? 'bluesky' : 'facebook';
  if (!readConfig(job)?.taggedPosts) {
    const publishing = publishingConfigSchema.parse({
      source: { type: 'site', feedUrl: 'https://tailnote.io/sitemap.xml', feedKind: 'sitemap', pathPrefix: '/', noun: 'signature concept' },
      channels: [{ platform: 'bluesky', mode: 'manual' }, { platform: 'facebook', mode: 'manual' }],
      taggedPosts: true,
      brief: 'Start a conversation with a small business, with the signature concept made for it.',
      notifyUserIds: [String(job.createdByUserId)],
      examples: {},
    });
    await Job.updateOne({ _id: job._id }, { $set: { publishing } });
  }
  const title = `An email signature concept for ${company}`;
  const token = randomBytes(16).toString('hex');
  const item = await PublishItem.findOneAndUpdate(
    { jobId: job._id, key: `signature:${domain}` },
    { $setOnInsert: { organizationId: job.organizationId, companyId: job.companyId, jobId: job._id, key: `signature:${domain}`, status: 'processed', title, url: `${LANDING}/${token}`, publicToken: token, concept: { company, imageUrl }, facts: { title, description: `Made for ${company} by Tailnote.` } } },
    { upsert: true, new: true }
  );
  await PublishDelivery.updateOne(
    { itemId: item!._id, platform },
    { $setOnInsert: { organizationId: job.organizationId, companyId: job.companyId, jobId: job._id, mode: 'manual', status: 'ready', body: post, link: item!.url, assets: [{ kind: 'image', url: imageUrl }] } },
    { upsert: true }
  );
  await notifyPeople(job.organizationId, [String(job.createdByUserId)], { subject: `Ready to review: ${title}`, intro: 'A new signature concept and its post are ready. Nothing goes out until you post it.', lines: [post], action: 'Review the post' })
    .catch((error: unknown) => console.error(`[signature-post] job ${job._id} notification failed`, error instanceof Error ? error.message : 'unknown'));
}

/** What the public landing page shows. A skipped post takes its page down. */
export async function publicSignatureConcept(token: string): Promise<{ company: string; imageUrl: string } | null> {
  if (!TOKEN.test(token)) return null;
  const item = await PublishItem.findOne({ publicToken: token }).select('concept').lean<{ _id: Types.ObjectId; concept?: { company?: string; imageUrl?: string } }>();
  if (!item?.concept?.company || !item.concept.imageUrl) return null;
  if (!(await PublishDelivery.exists({ itemId: item._id, status: { $ne: 'skipped' } }))) return null;
  return { company: item.concept.company, imageUrl: item.concept.imageUrl };
}
