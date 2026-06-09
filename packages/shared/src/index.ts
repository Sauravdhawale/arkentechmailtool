import { z } from "zod";

export const EMAIL_COLUMN_NAME = "emails";

export const emailSchema = z.string().trim().email();

export const singleVerifyRequestSchema = z.object({
  email: emailSchema
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(250).default(50)
});

export const jobStatusValues = [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled"
] as const;

export const emailStatusValues = [
  "valid",
  "invalid",
  "risky",
  "unknown",
  "duplicate"
] as const;

export const jobFilterSchema = z.enum(jobStatusValues).optional();
export const resultFilterSchema = z
  .enum([
    "all",
    "valid",
    "invalid",
    "risky",
    "unknown",
    "unknown_risky",
    "disposable",
    "duplicates"
  ])
  .default("all");

export type JobStatus = (typeof jobStatusValues)[number];
export type EmailStatus = (typeof emailStatusValues)[number];
export type ResultFilter = z.infer<typeof resultFilterSchema>;

export type NormalizedVerificationResult = {
  email: string;
  normalizedEmail: string;
  domain: string | null;
  status: Exclude<EmailStatus, "duplicate">;
  reason: string | null;
  reacherIsReachable: string | null;
  isDisposable: boolean;
  isAcceptAll: boolean;
  mxFound: boolean | null;
  smtpResult: string | null;
  rawResponse: unknown;
  checkedAt: string;
};

export type ReacherResponse = Record<string, unknown>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getEmailDomain(email: string): string | null {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  return atIndex > -1 ? normalized.slice(atIndex + 1) : null;
}

export function mapReacherReachability(value: unknown): Exclude<EmailStatus, "duplicate"> {
  switch (value) {
    case "safe":
      return "valid";
    case "invalid":
      return "invalid";
    case "risky":
      return "risky";
    case "unknown":
    default:
      return "unknown";
  }
}

export function isValidEmailSyntax(email: string): boolean {
  return emailSchema.safeParse(email).success;
}

function valueAt<T = unknown>(source: unknown, path: string[]): T | null {
  let cursor = source;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || !(key in cursor)) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor as T;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorMessage(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const message = asString(record.message);
  const type = asString(record.type);

  if (type && message) {
    return `${type}: ${message}`;
  }

  return message ?? type;
}

export function unwrapReacherResult(raw: ReacherResponse): ReacherResponse {
  if (raw.is_reachable) {
    return raw;
  }

  const candidates = [
    raw.result,
    raw.output,
    raw.verification,
    raw.response,
    raw.data
  ];

  for (const candidate of candidates) {
    const nested = asRecord(candidate);
    if (nested?.is_reachable) {
      return {
        ...nested,
        input: nested.input ?? raw.input ?? raw.email ?? raw.to_email
      };
    }
  }

  return raw;
}

function getReason(raw: ReacherResponse): string | null {
  return (
    asString(raw.reason) ??
    asString(raw.message) ??
    errorMessage(raw.error) ??
    errorMessage(valueAt(raw, ["syntax", "error"])) ??
    errorMessage(valueAt(raw, ["smtp", "error"])) ??
    errorMessage(raw.smtp) ??
    errorMessage(valueAt(raw, ["mx", "error"])) ??
    asString(raw.is_reachable) ??
    null
  );
}

function getDisposable(raw: ReacherResponse): boolean {
  return (
    asBoolean(valueAt(raw, ["misc", "is_disposable"])) ??
    asBoolean(raw.is_disposable) ??
    false
  );
}

function getAcceptAll(raw: ReacherResponse): boolean {
  return (
    asBoolean(valueAt(raw, ["smtp", "is_catch_all"])) ??
    asBoolean(valueAt(raw, ["smtp", "is_accept_all"])) ??
    asBoolean(raw.is_accept_all) ??
    false
  );
}

function getMxFound(raw: ReacherResponse): boolean | null {
  const acceptsMail = asBoolean(valueAt(raw, ["mx", "accepts_mail"]));
  if (acceptsMail !== null) {
    return acceptsMail;
  }

  const records = valueAt(raw, ["mx", "records"]);
  if (Array.isArray(records)) {
    return records.length > 0;
  }

  return null;
}

function getSmtpResult(raw: ReacherResponse): string | null {
  const smtpError =
    errorMessage(valueAt(raw, ["smtp", "error"])) ?? errorMessage(raw.smtp);
  if (smtpError) {
    return smtpError;
  }

  const deliverable = valueAt(raw, ["smtp", "is_deliverable"]);
  if (typeof deliverable === "boolean") {
    return deliverable ? "deliverable" : "not_deliverable";
  }

  const canConnect = valueAt(raw, ["smtp", "can_connect_smtp"]);
  if (typeof canConnect === "boolean") {
    return canConnect ? "connected" : "not_connected";
  }

  const method = asRecord(valueAt(raw, ["debug", "smtp", "verif_method"]));
  const methodType = asString(method?.type);
  const methodHost = asString(method?.host);
  const methodPort = method?.port;
  if (methodType) {
    return methodHost
      ? `${methodType} ${methodHost}${methodPort ? `:${methodPort}` : ""}`
      : methodType;
  }

  return (
    asString(valueAt(raw, ["smtp", "status"])) ??
    asString(raw.is_reachable) ??
    null
  );
}

export function normalizeReacherResult(
  email: string,
  raw: ReacherResponse
): NormalizedVerificationResult {
  raw = unwrapReacherResult(raw);
  const normalizedEmail = normalizeEmail(email);
  const reacherIsReachable = asString(raw.is_reachable);

  return {
    email,
    normalizedEmail,
    domain: getEmailDomain(normalizedEmail),
    status: mapReacherReachability(reacherIsReachable),
    reason: getReason(raw),
    reacherIsReachable,
    isDisposable: getDisposable(raw),
    isAcceptAll: getAcceptAll(raw),
    mxFound: getMxFound(raw),
    smtpResult: getSmtpResult(raw),
    rawResponse: raw,
    checkedAt: new Date().toISOString()
  };
}
