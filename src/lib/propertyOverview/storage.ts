import 'server-only';
import mongoose, { Types } from 'mongoose';
import { PropertyOverview, PropertyPage } from '@/lib/models/PropertyOverview';

type Completion = {
  completedAt: Date;
  progress: string;
  pageCount: number;
  edgeCount: number;
  issueCount: number;
  clusters: unknown[];
  summary: Record<string, number>;
};

/** Atomically promotes one completed crawl and removes every superseded report and page archive. */
export async function replaceCompanyOverview(input: {
  overviewId: Types.ObjectId;
  organizationId: Types.ObjectId;
  companyId: Types.ObjectId;
  completion: Completion;
}): Promise<void> {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const superseded = await PropertyOverview.find({
        _id: { $ne: input.overviewId },
        organizationId: input.organizationId,
        companyId: input.companyId,
      }).select('_id').session(session).lean<{ _id: Types.ObjectId }[]>();
      const supersededIds = superseded.map((row) => row._id);
      if (supersededIds.length) {
        await PropertyPage.deleteMany({ overviewId: { $in: supersededIds } }).session(session);
        await PropertyOverview.deleteMany({ _id: { $in: supersededIds } }).session(session);
      }
      const completed = await PropertyOverview.updateOne(
        { _id: input.overviewId, organizationId: input.organizationId, companyId: input.companyId, status: { $in: ['queued', 'dispatching', 'crawling'] } },
        { $set: { status: 'complete', ...input.completion } },
        { session }
      );
      if (completed.matchedCount !== 1) throw new Error('The active Company Overview could not be finalized.');
    });
  } finally {
    await session.endSession();
  }
}
