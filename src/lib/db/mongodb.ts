import 'server-only';
import mongoose from 'mongoose';
import { migrateOrganizationSlugs } from '@/lib/db/migrateOrganizationSlugs';

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

// Use global to maintain a cached connection across hot reloads in development
declare global {
   
  var mongoose: MongooseCache | undefined;
}

const cached: MongooseCache = global.mongoose || { conn: null, promise: null };

if (!global.mongoose) {
  global.mongoose = cached;
}

async function connectDB(): Promise<typeof mongoose> {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable inside .env.local');
  }

  // A cached connection is only good while it is connected. After a network drop it is reconnecting (or gone), and
  // handing it out makes every request wait for server selection, so start a fresh connection instead.
  if (cached.conn) {
    if (mongoose.connection.readyState === 1) return cached.conn;
    if (mongoose.connection.readyState === 2 && cached.promise) {
      cached.conn = await cached.promise;
      return cached.conn;
    }
    cached.conn = null;
    cached.promise = null;
    await mongoose.disconnect().catch(() => undefined);
  }

  // If we don't have a promise, create one
  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      // Fail in seconds, not the 30-second default, so a dropped connection is retried quickly instead of hanging.
      serverSelectionTimeoutMS: 8_000,
      connectTimeoutMS: 10_000,
      socketTimeoutMS: 60_000,
      // Close idle sockets before Atlas, a proxy or the platform does, so a reused connection is never a dead one.
      maxIdleTimeMS: 45_000,
      // Many serverless instances share one cluster: a small pool each keeps the total well under its connection limit.
      maxPoolSize: 10,
      minPoolSize: 0,
      heartbeatFrequencyMS: 10_000,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
    try {
      await migrateOrganizationSlugs();
    } catch (migrateErr) {
      console.error('[organization] slug migration failed', migrateErr);
    }
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default connectDB;
