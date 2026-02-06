/**
 * Custom error for when an index doesn't exist.
 * This error should not trigger retries - the index is gone and won't come back.
 */
export class IndexNotFoundError extends Error {
  constructor(indexName: string) {
    super(`Index ${indexName} does not exist`);
    this.name = 'IndexNotFoundError';
    Object.setPrototypeOf(this, IndexNotFoundError.prototype);
  }
}
