export type ErrorCode =
  | "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid"
  | "rate_limited" | "insufficient_credit" | "unavailable" | "frozen";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401, forbidden: 403, not_found: 404, conflict: 409, invalid: 422,
  rate_limited: 429, insufficient_credit: 409, unavailable: 503, frozen: 423,
};

/** A user-presentable domain error. Never carries stack traces or secrets. */
export class DomainError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
}
export const fail = (code: ErrorCode, message: string, details?: Record<string, unknown>): never => {
  throw new DomainError(code, message, details);
};
