import { ConfigService } from '@nestjs/config';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly redis: Redis;
  private readonly prefix = 'throttle';

  constructor(config: ConfigService) {
    this.redis = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
    });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const namespacedKey = `${this.prefix}:${throttlerName}:${key}`;
    const blockKey = `${namespacedKey}:blocked`;

    const activeBlockTtl = await this.redis.pttl(blockKey);
    if (activeBlockTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: await this.getTimeToExpire(namespacedKey, ttl),
        isBlocked: true,
        timeToBlockExpire: activeBlockTtl,
      };
    }

    const totalHits = await this.redis.incr(namespacedKey);
    if (totalHits === 1) {
      await this.redis.pexpire(namespacedKey, ttl);
    }

    const isBlocked = totalHits > limit;
    if (isBlocked) {
      await this.redis.psetex(blockKey, blockDuration, '1');
    }

    return {
      totalHits,
      timeToExpire: await this.getTimeToExpire(namespacedKey, ttl),
      isBlocked,
      timeToBlockExpire: isBlocked ? blockDuration : 0,
    };
  }

  private async getTimeToExpire(key: string, fallbackTtl: number) {
    const ttl = await this.redis.pttl(key);
    return ttl > 0 ? ttl : fallbackTtl;
  }
}
