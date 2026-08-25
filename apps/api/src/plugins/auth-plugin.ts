import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifySession, type SessionPayload } from "../lib/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    session: SessionPayload | null;
  }
}

const COOKIE_NAME = "rr_session";

/**
 * Attaches `req.session` (or null) on every request by reading the signed
 * JWT session cookie. Applied directly to the app (not via app.register) so
 * the decorator/hook cover every route, including ones registered after
 * this call.
 */
export function attachAuthContext(app: FastifyInstance): void {
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (req: FastifyRequest) => {
    const token = req.cookies?.[COOKIE_NAME];
    req.session = token ? verifySession(token) : null;
  });
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

export function requireAuth(req: FastifyRequest): SessionPayload {
  if (!req.session) {
    const err = new Error("authentication_required") as Error & { statusCode?: number };
    err.statusCode = 401;
    throw err;
  }
  return req.session;
}
