/**
 * Errors raised by business rules. `kind` tells the UI/API layer how to
 * respond; `code` is a stable identifier for messages and tests.
 */
export type ErrorKind =
  | "validation"
  | "not_found"
  | "conflict"
  | "forbidden"
  | "unauthorized"
  | "limit_reached";

export class AppError extends Error {
  override readonly name: string = "AppError";

  constructor(
    readonly kind: ErrorKind,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export class ValidationError extends AppError {
  override readonly name = "ValidationError";
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super("validation", code, message, details);
  }
}

export class NotFoundError extends AppError {
  override readonly name = "NotFoundError";
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super("not_found", code, message, details);
  }
}

export class ConflictError extends AppError {
  override readonly name = "ConflictError";
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super("conflict", code, message, details);
  }
}

export class ForbiddenError extends AppError {
  override readonly name = "ForbiddenError";
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super("forbidden", code, message, details);
  }
}

export class LimitReachedError extends AppError {
  override readonly name = "LimitReachedError";
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super("limit_reached", code, message, details);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
