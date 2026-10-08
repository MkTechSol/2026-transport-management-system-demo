export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Please sign in to continue.') => new AppError(401, 'UNAUTHENTICATED', msg);
export const forbidden = (msg = 'You do not have permission to perform this action.') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Record') => new AppError(404, 'NOT_FOUND', `${what} was not found.`);
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'CONFLICT', msg, details);
export const unprocessable = (msg: string, details?: unknown) => new AppError(422, 'RULE_VIOLATION', msg, details);
