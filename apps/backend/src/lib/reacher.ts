import {
  normalizeReacherResult,
  type ReacherResponse,
  type NormalizedVerificationResult
} from "@arken/shared";
import { config } from "../config.js";

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

  const response = await fetch(config.REACHER_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ to_email: email })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Reacher returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const raw = (await response.json()) as ReacherResponse;
  return normalizeReacherResult(email, raw);
}
