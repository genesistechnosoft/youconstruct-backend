import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

const INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 15_000;
const HEALTH_URL = 'https://youconstruct-backend.onrender.com/api/v1/health';

@Injectable()
export class KeepAliveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KeepAliveService.name);
  private startupTimeout: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;

  onModuleInit(): void {
    this.startupTimeout = setTimeout(() => {
      void this.ping();
      this.interval = setInterval(() => {
        void this.ping();
      }, INTERVAL_MS);
    }, STARTUP_DELAY_MS);

    this.logger.log(
      `Keep-alive enabled (every ${INTERVAL_MS}ms, first ping in ${STARTUP_DELAY_MS}ms)`,
    );
  }

  onModuleDestroy(): void {
    if (this.startupTimeout) {
      clearTimeout(this.startupTimeout);
      this.startupTimeout = null;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async ping(): Promise<void> {
    try {
      const response = await fetch(HEALTH_URL, {
        method: 'GET',
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        this.logger.warn(
          `Keep-alive ping failed: ${response.status} ${HEALTH_URL}`,
        );
        return;
      }

      this.logger.debug(`Keep-alive ping ok: ${HEALTH_URL}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Keep-alive ping error: ${message}`);
    }
  }
}
