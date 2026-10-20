const TRANSIENT = /^(MongoNetworkError|MongoNetworkTimeoutError|MongoServerSelectionError|MongoPoolClearedError|MongoTopologyClosedError|MongoNotConnectedError)$/;

/**
 * Retries work that is safe to run twice: a settings save that only sets values. A dropped connection is retried
 * a few times with a short wait (the pool needs a moment to reconnect). Never use it for anything that creates,
 * increments, submits or publishes.
 */
export async function retryIdempotentWrite<T>(phase: string, write: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      if (!(error instanceof Error && TRANSIENT.test(error.name)) || attempt >= 4) throw error;
      console.warn('[database/write] retry', { phase, attempt, error: error.name });
      await new Promise((resolve) => setTimeout(resolve, attempt * 600));
    }
  }
}

/** Only wrap read-only work: never retry a callback that can submit or publish. */
export async function retryDatabaseRead<T>(phase: string, read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof Error && TRANSIENT.test(error.name)) || attempt >= 4) throw error;
      console.warn('[database/read] retry', { phase, attempt, error: error.name });
      await new Promise((resolve) => setTimeout(resolve, attempt * 600));
    }
  }
}
