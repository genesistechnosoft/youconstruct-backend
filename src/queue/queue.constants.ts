export const MEDIA_PROCESSING_QUEUE = 'MEDIA_PROCESSING_QUEUE';
export const PAYMENT_TIMEOUT_QUEUE = 'PAYMENT_TIMEOUT_QUEUE';
export const BULK_PRODUCT_UPLOAD_QUEUE = 'BULK_PRODUCT_UPLOAD_QUEUE';

/** Shared BullMQ defaults: retries + retention for completed/failed jobs. */
export const DEFAULT_QUEUE_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 604800, count: 5000 },
};
