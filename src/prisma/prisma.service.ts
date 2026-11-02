import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../generated/prisma/client.js';


type PrismaQueryEvent = {
  duration: number;
  target: string;
};

type PrismaClientWithQueryEvents = {
  $on(event: 'query', callback: (event: PrismaQueryEvent) => void): void;
};

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool: Pool;
  private readonly logger = new Logger(PrismaService.name);
  /** Queries at or above this duration (ms) emit a slow_query warning. Env: DATABASE_SLOW_QUERY_MS (default 300). */
  private readonly slowQueryMs: number;

  constructor(config: ConfigService) {
    // Pool sizing: DATABASE_POOL_MAX (default 10), DATABASE_POOL_IDLE_TIMEOUT_MS, DATABASE_POOL_CONNECTION_TIMEOUT_MS
    const pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: PrismaService.getPositiveInt(config, 'DATABASE_POOL_MAX', 10),
      idleTimeoutMillis: PrismaService.getPositiveInt(
        config,
        'DATABASE_POOL_IDLE_TIMEOUT_MS',
        30_000,
      ),
      connectionTimeoutMillis: PrismaService.getPositiveInt(
        config,
        'DATABASE_POOL_CONNECTION_TIMEOUT_MS',
        10_000,
      ),
    });
    super({
      adapter: new PrismaPg(pool),
      log: [{ emit: 'event', level: 'query' }],
    });
    this.pool = pool;
    this.slowQueryMs = PrismaService.getPositiveInt(
      config,
      'DATABASE_SLOW_QUERY_MS',
      300,
    );
  }

  async onModuleInit() {
    await this.$connect();
    (this as unknown as PrismaClientWithQueryEvents).$on('query', (event) => {
      if (event.duration >= this.slowQueryMs) {
        this.logger.warn(
          `slow_query durationMs=${event.duration} target=${event.target}`,
        );
      }
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }

  private static getPositiveInt(
    config: ConfigService,
    key: string,
    fallback: number,
  ) {
    const raw = config.get<string>(key);
    if (!raw) {
      return fallback;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}


