import { createHash, randomBytes } from 'node:crypto';
import mongoose, { Schema } from 'mongoose';
import connectDB from '@/lib/db/mongodb';
import User from '@/lib/models/User';
import { effectiveRegistrationApproval } from './registrationApproval';

export const DESKTOP_REFRESH_COOKIE = 'nucleas-desktop-refresh';
export const DESKTOP_REFRESH_PATH = '/api/auth/desktop';
export const DESKTOP_IDLE_DAYS = 90;
const schema = new Schema({
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    credentialsHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
}, { timestamps: true });
const Device = mongoose.models.DesktopSession || mongoose.model('DesktopSession', schema);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fingerprint = (user: { password?: string; googleId?: string }) => hash(`${user.password ?? ''}:${user.googleId ?? ''}`);
const expiry = () => new Date(Date.now() + DESKTOP_IDLE_DAYS * 86400_000);

export async function createDesktopSession(userId: string) {
    await connectDB();
    const user = await User.findById(userId);
    if (!user || effectiveRegistrationApproval(user.registrationApproval) !== 'approved') return null;
    const token = randomBytes(32).toString('hex'), expiresAt = expiry();
    const record = await Device.create({ tokenHash: hash(token), userId: user._id, credentialsHash: fingerprint(user), expiresAt });
    return { id: String(record._id), token, expiresAt, user };
}

/** A revocable device credential; its idle expiry extends while this app is used. */
export async function renewDesktopSession(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    await connectDB();
    const record = await Device.findOne({ tokenHash: hash(token), expiresAt: { $gt: new Date() } });
    if (!record) return null;
    const user = await User.findById(record.userId);
    if (!user || effectiveRegistrationApproval(user.registrationApproval) !== 'approved' || record.credentialsHash !== fingerprint(user)) {
        await Device.deleteOne({ _id: record._id }); return null;
    }
    const expiresAt = expiry();
    // Do not recreate a device concurrently revoked by sign-out.
    const changed = await Device.updateOne({ _id: record._id, tokenHash: hash(token) }, { $set: { expiresAt } });
    return changed.matchedCount ? { id: String(record._id), token, expiresAt, user } : null;
}

export async function revokeDesktopSession(id: string, userId: string) {
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(userId)) return;
    await connectDB(); await Device.deleteOne({ _id: id, userId });
}
