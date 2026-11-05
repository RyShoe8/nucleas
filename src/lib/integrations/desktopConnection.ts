import mongoose, { Schema } from 'mongoose';
import { NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
const schema = new Schema({
    flow: { type: String, required: true, unique: true }, userId: String, companyId: String,
    error: Boolean, message: String, expiresAt: { type: Date, expires: 0 },
});
export const DesktopConnection = mongoose.models.DesktopConnection || mongoose.model('DesktopConnection', schema);
export async function completeDesktopConnection(request: Request, state: { userId: string; companyId?: string | null; desktopFlow?: string }, params: Record<string, string>) {
    await connectDB();
    await DesktopConnection.updateOne({ flow: state.desktopFlow }, { $setOnInsert: {
        userId: state.userId, companyId: state.companyId ?? undefined, error: Boolean(params.integration_error),
        message: params.integration_error || params.integration_notice || 'Connection completed.', expiresAt: new Date(Date.now() + 600_000),
    } }, { upsert: true });
    return NextResponse.redirect(new URL(`/desktop/connection-complete?result=${params.integration_error ? 'error' : 'success'}`, request.url));
}
