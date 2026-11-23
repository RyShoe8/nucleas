import { createHash, randomBytes } from 'node:crypto';
import mongoose, { Schema } from 'mongoose';
import connectDB from '@/lib/db/mongodb';

const schema = new Schema({
    requestId: { type: String, required: true, unique: true },
    proofHash: { type: String, required: true },
    code: { type: String, required: true },
    userId: String,
    callbackPort: Number,
    callbackNonce: String,
    callbackHash: String,
    expiresAt: { type: Date, required: true, expires: 0 },
});
const Grant = mongoose.models.DesktopGrant || mongoose.model('DesktopGrant', schema);
export const validDesktopId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export const validCallbackPort = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1024 && Number(value) <= 65535;
export async function startDesktopGrant(callback?: { port: number; nonce: string }) {
    if (callback && (!validCallbackPort(callback.port) || !validDesktopId(callback.nonce))) throw Error('Invalid desktop callback.');
    await connectDB();
    const requestId = randomBytes(32).toString('hex');
    const proof = randomBytes(32).toString('hex');
    const code = randomBytes(4).toString('hex').toUpperCase();
    await Grant.create({ requestId, proofHash: hash(proof), code, ...(callback ? { callbackPort: callback.port, callbackNonce: callback.nonce } : {}), expiresAt: new Date(Date.now() + 10 * 60_000) });
    return { requestId, proof, code };
}
export async function readDesktopGrant(requestId: string) {
    await connectDB();
    return Grant.findOne({ requestId, expiresAt: { $gt: new Date() } });
}
export async function approveDesktopGrant(requestId: string, userId: string) {
    await connectDB();
    return Grant.findOneAndUpdate({ requestId, callbackPort: { $exists: false }, userId: { $exists: false }, expiresAt: { $gt: new Date() } }, { $set: { userId } });
}
/** The one-time callback secret goes only to this computer, never to a polling client. */
export async function completeDesktopGrant(requestId: string, userId: string) {
    await connectDB();
    const code = randomBytes(32).toString('hex');
    const grant = await Grant.findOneAndUpdate({ requestId, callbackPort: { $gte: 1024, $lte: 65535 }, userId: { $exists: false }, expiresAt: { $gt: new Date() } }, { $set: { userId, callbackHash: hash(code) } }, { new: true });
    if (!grant || !validDesktopId(grant.callbackNonce)) return null;
    const url = new URL(`http://127.0.0.1:${grant.callbackPort}/nucleas-auth/${grant.callbackNonce}`);
    url.searchParams.set('request', requestId); url.searchParams.set('code', code);
    return url.href;
}
export async function consumeDesktopGrant(requestId: string, proof: string, callbackCode?: string) {
    await connectDB();
    // Atomic consumption: concurrent polls and replay cannot create a second session.
    return Grant.findOneAndDelete({ requestId, proofHash: hash(proof), userId: { $exists: true }, expiresAt: { $gt: new Date() },
        ...(validDesktopId(callbackCode) ? { callbackPort: { $exists: true }, callbackHash: hash(callbackCode) } : { callbackPort: { $exists: false } }),
    });
}
