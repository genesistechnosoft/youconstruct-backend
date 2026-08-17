import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Prisma } from '../../../generated/prisma/client.js';
import { formatMoney } from '../utils/money.util';

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((response: unknown): ApiResponse<T> => {
        if (
          response !== null &&
          typeof response === 'object' &&
          'success' in response
        ) {
          return response as ApiResponse<T>;
        }

        const body =
          response !== null && typeof response === 'object'
            ? (response as Record<string, unknown>)
            : undefined;
        const fallbackData = (() => {
          if (!body || body.message === undefined) {
            return response as T;
          }

          const rest = { ...body };
          delete rest.message;
          delete rest.meta;
          return Object.keys(rest).length > 0 ? (rest as T) : null;
        })();

        return {
          success: true,
          message: (body?.message as string | undefined) ?? 'Success',
          data: this.serializeValue(
            body && 'data' in body ? body.data : fallbackData,
          ) as T,
          ...(body?.meta
            ? {
                meta: body.meta as {
                  page: number;
                  limit: number;
                  total: number;
                  totalPages: number;
                },
              }
            : {}),
        };
      }),
    );
  }

  private serializeValue(value: unknown): unknown {
    if (value instanceof Prisma.Decimal) {
      return formatMoney(value);
    }

    if (value instanceof Date) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.serializeValue(item));
    }

    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          this.serializeValue(item),
        ]),
      );
    }

    return value;
  }
}
