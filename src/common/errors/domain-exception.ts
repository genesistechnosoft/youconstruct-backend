import { HttpException, HttpStatus } from '@nestjs/common';
import type { DomainErrorCode } from './domain-error-code';

export type DomainErrorDetail = {
  field?: string;
  message: string;
};

export class DomainException extends HttpException {
  constructor(
    status: HttpStatus,
    error: DomainErrorCode,
    message: string,
    details?: DomainErrorDetail[],
  ) {
    super(
      {
        message,
        error,
        ...(details ? { details } : {}),
      },
      status,
    );
  }
}

export function domainBadRequest(
  error: DomainErrorCode,
  message: string,
  details?: DomainErrorDetail[],
) {
  return new DomainException(HttpStatus.BAD_REQUEST, error, message, details);
}

export function domainForbidden(error: DomainErrorCode, message: string) {
  return new DomainException(HttpStatus.FORBIDDEN, error, message);
}

export function domainConflict(error: DomainErrorCode, message: string) {
  return new DomainException(HttpStatus.CONFLICT, error, message);
}
