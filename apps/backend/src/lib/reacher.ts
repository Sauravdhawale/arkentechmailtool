import {
  getEmailDomain,
  normalizeEmail,
  normalizeReacherResult,
  type ReacherResponse,
  type NormalizedVerificationResult
} from "@arken/shared";
import { config } from "../config.js";

export class ReacherVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReacherVerificationError";
  }
}

export function unknownVerificationResult(
  email: string,
  message: string
): NormalizedVerificationResult {
  const normalizedEmail = normalizeEmail(email);

  return {
    email,
    normalizedEmail,
    domain: getEmailDomain(normalizedEmail),
    status: "unknown",
    reason: message,
    reacherIsReachable: "unknown",
    isDisposable: false,
    isAcceptAll: false,
    mxFound: null,
    smtpResult: message,
    rawResponse: {
      is_reachable: "unknown",
      error: message
    },
    checkedAt: new Date().toISOString()
  };
}

export async function verifyEmailWithReacher(
  email: string
): Promise<NormalizedVerificationResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (config.REACHER_API_TOKEN) {
    headers.Authorization = config.REACHER_API_TOKEN.startsWith("Bearer ")
      ? config.REACHER_API_TOKEN
      : `Bearer ${config.REACHER_API_TOKEN}`;
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    config.REACHER_REQUEST_TIMEOUT_MS
  );

  let response: Response;
  try {
    response = await fetch(config.REACHER_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ to_email: email }),
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ReacherVerificationError(
        `Reacher verification timed out after ${Math.round(
          config.REACHER_REQUEST_TIMEOUT_MS / 1000
        )} seconds.`
      );
    }

    throw new ReacherVerificationError(
      error instanceof Error ? error.message : "Unable to reach Reacher."
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new ReacherVerificationError(
      `Reacher returned HTTP ${response.status}: ${body.slice(0, 300)}`
    );
  }

  const raw = (await response.json()) as ReacherResponse;
  return normalizeReacherResult(email, raw);
}
