import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isValidWalletAddress, issueNonce, buildSignInMessage, verifySignedNonce, signSession } from "../lib/auth.js";
import { SESSION_COOKIE_NAME } from "../plugins/auth-plugin.js";
import { badRequest, unauthorized } from "../lib/http-errors.js";

const NonceSchema = z.object({ address: z.string() });
const VerifySchema = z.object({ address: z.string(), signature: z.string() });

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/auth/nonce",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = NonceSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("address is required");
      const { address } = parsed.data;
      if (!isValidWalletAddress(address)) throw badRequest("address must be a valid EVM address");

      const nonce = await issueNonce(address);
      const message = buildSignInMessage(address, nonce);
      return reply.send({ nonce, message });
    },
  );

  app.post(
    "/auth/verify",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = VerifySchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("address and signature are required");
      const { address, signature } = parsed.data;
      if (!isValidWalletAddress(address)) throw badRequest("address must be a valid EVM address");

      const ok = await verifySignedNonce(address, signature);
      if (!ok) throw unauthorized("signature verification failed or nonce expired");

      const token = signSession({ walletAddress: address.toLowerCase() });
      reply.setCookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
      return reply.send({ walletAddress: address.toLowerCase() });
    },
  );

  app.post("/auth/logout", async (req, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return reply.send({ ok: true });
  });

  app.get("/auth/session", async (req, reply) => {
    return reply.send({ session: req.session });
  });
}
