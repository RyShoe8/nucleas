import { createHash, randomBytes } from 'node:crypto';
import mongoose, { Schema } from 'mongoose';
import connectDB from '@/lib/db/mongodb';

const schema = new Schema({
    requestId: { type: String, required: true, unique: true },
    proofHash: { type: String, required: true },
    code: { type: String, required: true },
    userId: String,
    expiresAt: { type: Date, required: true, expires: 0 },
});
const Grant = mongoose.models.DesktopGrant || mongoose.model('DesktopGrant', schema);
export const validDesktopId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function startDesktopGrant() {
    await connectDB();
    const requestId = randomBytes(32).toString('hex');
    const proof = randomBytes(32).toString('hex');
    const code = randomBytes(4).toString('hex').toUpperCase();
    await Grant.create({ requestId, proofHash: hash(proof), code, expiresAt: new Date(Date.now() + 10 * 60_000) });
    return { requestId, proof, code };
}
export async function readDesktopGrant(requestId: string) {
    await connectDB();
    return Grant.findOne({ requestId, expiresAt: { $gt: new Date() } });
}
export async function approveDesktopGrant(requestId: string, userId: string) {
    await connectDB();
    return Grant.findOneAndUpdate({ requestId, userId: { $exists: false }, expiresAt: { $gt: new Date() } }, { $set: { userId } });
}
export async function consumeDesktopGrant(requestId: string, proof: string) {
    await connectDB();
    // Atomic consumption: concurrent polls and replay cannot create a second session.
    return Grant.findOneAndDelete({ requestId, proofHash: hash(proof), userId: { $exists: true }, expiresAt: { $gt: new Date() } });
}
