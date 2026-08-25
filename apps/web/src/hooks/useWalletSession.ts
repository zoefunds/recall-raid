'use client';

import { useCallback, useRef } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { requestAuthNonce, verifyAuthSignature, ApiError } from '@/lib/api';

// Module-level (not component-level) so the "already authenticated" fact
// survives remounts across pages, and so two call sites racing to call
// ensureSession() for the same address share one in-flight sign request
// instead of prompting the wallet twice.
let authenticatedAddress: string | null = null;
let inFlight: Promise<void> | null = null;

/**
 * Establishes (or confirms) an authenticated session with the API for the
 * connected wallet, via the challenge-nonce-signature flow the backend
 * already implements (POST /auth/nonce -> sign -> POST /auth/verify, which
 * sets an httpOnly session cookie). Every requireAuth-gated endpoint —
 * evidence uploads, all the /*\/sync triggers, notifications — needs this
 * to have run first, or every one of those calls 401s.
 *
 * Call `ensureSession()` right before the first authenticated action in a
 * flow (e.g. at the top of a submit/upload/sync handler) rather than
 * eagerly on every wallet connect — that way the signature prompt appears
 * with clear context for why, instead of immediately on connect with no
 * explanation.
 */
export function useWalletSession() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const addressRef = useRef(address);
  addressRef.current = address;

  const ensureSession = useCallback(async (): Promise<void> => {
    const current = addressRef.current;
    if (!current) throw new Error('Connect your wallet first.');

    if (authenticatedAddress?.toLowerCase() === current.toLowerCase()) {
      return;
    }
    if (inFlight) {
      await inFlight;
      if (authenticatedAddress?.toLowerCase() === current.toLowerCase()) return;
    }

    inFlight = (async () => {
      const { message } = await requestAuthNonce(current);
      const signature = await signMessageAsync({ message });
      await verifyAuthSignature(current, signature);
      authenticatedAddress = current;
    })();

    try {
      await inFlight;
    } catch (err) {
      authenticatedAddress = null;
      if (err instanceof ApiError) {
        throw new Error('Could not verify your wallet with RecallRaid. Please try again.');
      }
      throw new Error('Signature request was rejected or failed.');
    } finally {
      inFlight = null;
    }
  }, [signMessageAsync]);

  return { ensureSession };
}
