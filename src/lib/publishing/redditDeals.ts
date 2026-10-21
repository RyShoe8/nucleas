import mongoose, { Schema, type ClientSession, type Types } from 'mongoose';
import { PublishDelivery, PublishItem } from '@/lib/models/Publishing';
import { WatchItem } from '@/lib/models/Watch';

const lockSchema = new Schema({ _id: String, version: { type: Number, default: 0 } });
const RedditDealLock = mongoose.models.RedditDealLock ?? mongoose.model('RedditDealLock', lockSchema);

type DealCard = { organizationId: Types.ObjectId; companyId: Types.ObjectId; itemId: Types.ObjectId };

/** Prefer the saved admin casino ID/name; never guess a casino from generated copy. */
export async function casinoFor(card: DealCard): Promise<string | null> {
  const item = await PublishItem.findOne({ _id: card.itemId, organizationId: card.organizationId, companyId: card.companyId }).select('key').lean();
  if (!item || !mongoose.isValidObjectId(item.key)) return null;
  const email = await WatchItem.findOne({ _id: item.key, organizationId: card.organizationId }).select('bestDeal fromEmail values').lean();
  if (!email?.bestDeal) return null;
  const siblings = await PublishItem.find({ organizationId: card.organizationId, companyId: card.companyId, key: item.key }).select('_id').lean();
  const admin = await PublishDelivery.findOne({ organizationId: card.organizationId, companyId: card.companyId, platform: 'admin', status: 'posted', itemId: { $in: siblings.map((row) => row._id) } }).sort({ postedAt: -1, createdAt: -1 }).select('values').lean();
  const values = admin?.values ?? email.values ?? {};
  const casino = values.casino_id ?? values.casino ?? values.casino_name;
  if (casino !== undefined && String(casino).trim()) return String(casino).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  // Sender domain provides a stable fallback for inbox deals without admin intake.
  return email.fromEmail?.split('@')[1]?.toLowerCase().replace(/^(mail|email|news|info|promo|promotions|marketing)\./, '') ?? null;
}

export async function redditDealHistory(card: DealCard, session?: ClientSession): Promise<{ casino: string; postedAt: Date }[]> {
  const history = await PublishDelivery.find({ organizationId: card.organizationId, companyId: card.companyId, platform: 'reddit', status: 'posted' }).sort({ postedAt: -1, _id: -1 }).session(session ?? null).lean();
  const deals: { casino: string; postedAt: Date }[] = [];
  for (const prior of history) {
    const priorCasino = await casinoFor(prior);
    if (!priorCasino) continue;
    deals.push({ casino: priorCasino, postedAt: prior.postedAt ?? prior.updatedAt });
    if (deals.length === 2) break;
  }
  return deals;
}

export async function redditDealBlock(card: DealCard, timezone: string, now = new Date(), session?: ClientSession, history?: Awaited<ReturnType<typeof redditDealHistory>>): Promise<string | null> {
  const casino = await casinoFor(card);
  if (!casino) return 'The casino must be identified before this Reddit deal can be posted.';
  const date = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(value);
  const previous = history ?? await redditDealHistory(card, session);
  if (previous.some((prior) => date(prior.postedAt) === date(now))) return `One casino deal has already been posted to Reddit today (${timezone}). The next deal waits until tomorrow.`;
  if (previous.some((prior) => prior.casino === casino)) return 'This casino appeared in the last two Reddit deals. Post two other casinos before using it again.';
  return null;
}

/** Serialize confirmations across employees and jobs, including simultaneous requests. */
export async function withRedditDealLock<T>(card: DealCard, work: (session: ClientSession) => Promise<T>): Promise<T> {
  const id = `${card.organizationId}:${card.companyId}`;
  try {
    await RedditDealLock.updateOne({ _id: id }, { $setOnInsert: { version: 0 } }, { upsert: true });
  } catch (error) {
    if (!(error instanceof mongoose.mongo.MongoServerError && error.code === 11000)) throw error;
  }
  return mongoose.connection.transaction(async (session) => {
    await RedditDealLock.updateOne({ _id: id }, { $inc: { version: 1 } }, { session });
    return work(session);
  });
}
