/** Only wrap read-only work: never retry a callback that can submit or publish. */
export async function retryDatabaseRead<T>(phase: string, read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      const transient = error instanceof Error && /^(MongoNetworkError|MongoNetworkTimeoutError|MongoServerSelectionError|MongoPoolClearedError|MongoTopologyClosedError|MongoNotConnectedError)$/.test(error.name);
      if (!transient || attempt >= 3) throw error;
      console.warn('[database/read] retry', { phase, attempt, error: (error as Error).name });
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
}
