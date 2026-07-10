import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    let status = 500;
    let message: string | string[] = 'Internal server error';
    let error = 'INTERNAL_SERVER_ERROR';
    let details: { message: string }[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const body = exceptionResponse as Record<string, unknown>;

        if (Array.isArray(body.message)) {
          message = 'Validation failed';
          details = body.message.map((item) => ({
            message: String(item),
          }));
        } else if (body.message !== undefined) {
          message = body.message as string;
        }
      }

      const statusToError: Record<number, string> = {
        400: 'BAD_REQUEST',
        401: 'UNAUTHORIZED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'CONFLICT',
        429: 'TOO_MANY_REQUESTS',
        500: 'INTERNAL_SERVER_ERROR',
      };

      error = statusToError[status] ?? 'INTERNAL_SERVER_ERROR';
    }

    const errorResponse: {
      success: false;
      message: string | string[];
      error: string;
      statusCode: number;
      details?: { message: string }[];
    } = {
      success: false,
      message,
      error,
      statusCode: status,
    };

    if (details) {
      errorResponse.details = details;
    }

    response.status(status).json(errorResponse);
  }
}
