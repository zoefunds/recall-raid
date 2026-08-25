export class ApiError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function notFound(message: string): ApiError {
  return new ApiError(404, "not_found", message);
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, "bad_request", message);
}

export function unauthorized(message = "authentication_required"): ApiError {
  return new ApiError(401, "unauthorized", message);
}
