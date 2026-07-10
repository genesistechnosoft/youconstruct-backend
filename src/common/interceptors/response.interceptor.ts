import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

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

        return {
          success: true,
          message: (body?.message as string | undefined) ?? 'Success',
          data: (body?.data as T | undefined) ?? (response as T),
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
}
