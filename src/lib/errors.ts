export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 500,
  ) {
    super(message);
  }
}
export function notImplemented(service: string): never {
  throw new AppError(
    "PROVIDER_NOT_IMPLEMENTED",
    `${service} is not connected yet. Live mode never substitutes demo data.`,
    501,
  );
}
