import "dotenv/config";
import {
  normalizeEmail,
  normalizeReacherResult,
  type NormalizedVerificationResult,
  type ReacherResponse
} from "@arken/shared";
import { EmailStatus, JobStatus, Prisma, PrismaClient } from "@prisma/client";
import { Job, Worker } from "bullmq";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  REACHER_API_URL: z
    .string()
    .url()
    .default("https://verify.arkentechsolutions.com/v1/check_email"),
  REACHER_BULK_API_URL: z.string().url().optional(),
  REACHER_API_TOKEN: z.string().optional().default(""),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
  WORKER_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  BULK_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  BULK_RESULTS_PAGE_SIZE: z.coerce.number().int().positive().max(1000).default(1000),
  BULK_MAX_WAIT_MINUTES: z.coerce.number().int().positive().default(240)
});

const parsedConfig = envSchema.parse(process.env);
const config = {
  ...parsedConfig,
  REACHER_BULK_API_URL:
    parsedConfig.REACHER_BULK_API_URL ??
    parsedConfig.REACHER_API_URL.replace(/\/check_email\/?$/, "/bulk")
};

const queueName = "email-verification";

type LegacyEmailVerificationJobData = {
  jobId: string;
  emailResultId: string;
  email: string;
};

type BulkEmailVerificationJobData = {
  jobId: string;
};

type EmailVerificationJobData =
  | LegacyEmailVerificationJobData
  | BulkEmailVerificationJobData;

type EmailVerificationJobName = "verify-email" | "verify-bulk-job";

type PendingEmailResult = {
  id: string;
  email: string;
  normalizedEmail: string;
};

type ReacherBulkCreateResponse = {
  job_id?: number | string;
};

type ReacherBulkStatusResponse = {
  job_status?: string;
  status?: string;
  total_processed?: number;
};

class JobStoppedError extends Error {
  constructor() {
    super("Job was stopped before completion.");
    this.name = "JobStoppedError";
  }
}

class ReacherHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
    this.name = "ReacherHttpError";
  }
}

const prisma = new PrismaClient();

function connectionOptions(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null
  };
}

const redisConnection = connectionOptions(config.REDIS_URL);

function toPrismaStatus(status: NormalizedVerificationResult["status"]): EmailStatus {
  return status.toUpperCase() as EmailStatus;
}

function isLegacyEmailJobData(
  data: EmailVerificationJobData
): data is LegacyEmailVerificationJobData {
  return "emailResultId" in data && "email" in data;
}

function authHeaders(includeJson = false): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };

  if (includeJson) {
    headers["Content-Type"] = "application/json";
  }

  if (config.REACHER_API_TOKEN) {
    headers.Authorization = config.REACHER_API_TOKEN.startsWith("Bearer ")
      ? config.REACHER_API_TOKEN
      : `Bearer ${config.REACHER_API_TOKEN}`;
  }

  return headers;
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  label: string
): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ReacherHttpError(
        `${label} returned HTTP ${response.status}: ${body.slice(0, 300)}`,
        response.status,
        body
      );
    }

    return (await response.json()) as T;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function verifyEmail(email: string): Promise<NormalizedVerificationResult> {
  const raw = await fetchJson<ReacherResponse>(
    config.REACHER_API_URL,
    {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ to_email: email })
    },
    "Reacher"
  );

  return normalizeReacherResult(email, raw);
}

async function isStopped(jobId: string): Promise<boolean> {
  const job = await prisma.bulkJob.findUnique({
    where: { id: jobId },
    select: { status: true }
  });

  return (
    !job ||
    job.status === JobStatus.CANCELLED ||
    job.status === JobStatus.COMPLETED ||
    job.status === JobStatus.FAILED
  );
}

async function ensureCanContinue(jobId: string) {
  if (await isStopped(jobId)) {
    throw new JobStoppedError();
  }
}

async function sleepWithStopChecks(jobId: string, milliseconds: number) {
  let remaining = milliseconds;
  while (remaining > 0) {
    const interval = Math.min(remaining, 1000);
    await sleep(interval);
    remaining -= interval;
    await ensureCanContinue(jobId);
  }
}

async function processedCountFromResults(jobId: string): Promise<number> {
  return prisma.emailResult.count({
    where: {
      jobId,
      OR: [{ checkedAt: { not: null } }, { isDuplicate: true }]
    }
  });
}

async function recomputeJobCounters(
  jobId: string,
  status: JobStatus,
  errorMessage: string | null = null
) {
  const currentJob = await prisma.bulkJob.findUnique({
    where: { id: jobId },
    select: { totalRecords: true, status: true }
  });

  if (!currentJob || currentJob.status === JobStatus.CANCELLED) {
    return;
  }

  const [
    statusGroups,
    processedCount,
    riskyOrAcceptAllCount,
    disposableCount,
    acceptAllCount
  ] = await Promise.all([
    prisma.emailResult.groupBy({
      by: ["status"],
      where: { jobId },
      _count: { _all: true }
    }),
    processedCountFromResults(jobId),
    prisma.emailResult.count({
      where: {
        jobId,
        OR: [{ status: EmailStatus.RISKY }, { isAcceptAll: true }]
      }
    }),
    prisma.emailResult.count({ where: { jobId, isDisposable: true } }),
    prisma.emailResult.count({ where: { jobId, isAcceptAll: true } })
  ]);

  const statusCount = new Map(statusGroups.map((group) => [group.status, group._count._all]));

  await prisma.bulkJob.update({
    where: { id: jobId },
    data: {
      status,
      processedCount: Math.min(currentJob.totalRecords, processedCount),
      validCount: statusCount.get(EmailStatus.VALID) ?? 0,
      invalidCount: statusCount.get(EmailStatus.INVALID) ?? 0,
      riskyCount: riskyOrAcceptAllCount,
      unknownCount: statusCount.get(EmailStatus.UNKNOWN) ?? 0,
      disposableCount,
      acceptAllCount,
      completedAt: new Date(),
      errorMessage
    }
  });
}

async function incrementJobCounters(
  jobId: string,
  result: Pick<NormalizedVerificationResult, "status" | "isDisposable" | "isAcceptAll">
) {
  const currentJob = await prisma.bulkJob.findUnique({
    where: { id: jobId },
    select: { status: true }
  });
  if (!currentJob || currentJob.status === JobStatus.CANCELLED) {
    return;
  }

  const data = {
    processedCount: { increment: 1 },
    validCount: { increment: result.status === "valid" ? 1 : 0 },
    invalidCount: { increment: result.status === "invalid" ? 1 : 0 },
    riskyCount: { increment: result.status === "risky" || result.isAcceptAll ? 1 : 0 },
    unknownCount: { increment: result.status === "unknown" ? 1 : 0 },
    disposableCount: { increment: result.isDisposable ? 1 : 0 },
    acceptAllCount: { increment: result.isAcceptAll ? 1 : 0 }
  };

  await prisma.$transaction(async (tx) => {
    const updated = await tx.bulkJob.update({
      where: { id: jobId },
      data
    });

    if (updated.processedCount >= updated.totalRecords && updated.status !== JobStatus.CANCELLED) {
      await tx.bulkJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.COMPLETED,
          completedAt: new Date()
        }
      });
    }
  });
}

async function markUnknownAfterFinalLegacyAttempt(
  queueJob: Job<LegacyEmailVerificationJobData, unknown, "verify-email">,
  error: unknown
) {
  const currentJob = await prisma.bulkJob.findUnique({
    where: { id: queueJob.data.jobId },
    select: { status: true }
  });
  if (!currentJob || currentJob.status === JobStatus.CANCELLED) {
    return;
  }

  const message = error instanceof Error ? error.message : "Verification failed";
  const checkedAt = new Date();

  await prisma.emailResult.update({
    where: { id: queueJob.data.emailResultId },
    data: {
      status: EmailStatus.UNKNOWN,
      reason: "Verification failed after retry",
      errorMessage: message,
      checkedAt
    }
  });

  await incrementJobCounters(queueJob.data.jobId, {
    status: "unknown",
    isDisposable: false,
    isAcceptAll: false
  });
}

async function processLegacyEmailJob(
  queueJob: Job<LegacyEmailVerificationJobData, unknown, "verify-email">
) {
  const bulkJob = await prisma.bulkJob.findUnique({
    where: { id: queueJob.data.jobId }
  });

  if (
    !bulkJob ||
    bulkJob.status === JobStatus.CANCELLED ||
    bulkJob.status === JobStatus.COMPLETED ||
    bulkJob.status === JobStatus.FAILED
  ) {
    return;
  }

  await prisma.bulkJob.updateMany({
    where: {
      id: queueJob.data.jobId,
      status: JobStatus.QUEUED
    },
    data: {
      status: JobStatus.PROCESSING,
      startedAt: new Date()
    }
  });

  const storedResult = await prisma.emailResult.findUnique({
    where: { id: queueJob.data.emailResultId }
  });

  if (!storedResult || storedResult.checkedAt || storedResult.isDuplicate) {
    return;
  }

  try {
    const result = await verifyEmail(queueJob.data.email);
    const latestJob = await prisma.bulkJob.findUnique({
      where: { id: queueJob.data.jobId },
      select: { status: true }
    });
    if (!latestJob || latestJob.status === JobStatus.CANCELLED) {
      return;
    }

    await prisma.emailResult.update({
      where: { id: queueJob.data.emailResultId },
      data: {
        status: toPrismaStatus(result.status),
        reason: result.reason,
        reacherIsReachable: result.reacherIsReachable,
        isDisposable: result.isDisposable,
        isAcceptAll: result.isAcceptAll,
        mxFound: result.mxFound,
        smtpResult: result.smtpResult,
        rawResponseJson: result.rawResponse as Prisma.InputJsonValue,
        checkedAt: new Date(result.checkedAt)
      }
    });

    await incrementJobCounters(queueJob.data.jobId, result);
  } catch (error) {
    const maxAttempts = typeof queueJob.opts.attempts === "number" ? queueJob.opts.attempts : 1;
    const isFinalAttempt = queueJob.attemptsMade + 1 >= maxAttempts;
    if (!isFinalAttempt) {
      throw error;
    }
    await markUnknownAfterFinalLegacyAttempt(queueJob, error);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bulkJobUrl(remoteJobId: string) {
  return `${config.REACHER_BULK_API_URL.replace(/\/$/, "")}/${encodeURIComponent(remoteJobId)}`;
}

function bulkResultsUrl(remoteJobId: string, limit: number, offset: number) {
  const url = new URL(`${bulkJobUrl(remoteJobId)}/results`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  return url.toString();
}

function extractBulkResults(payload: unknown): ReacherResponse[] {
  const record = asRecord(payload);
  const rawResults = record?.results ?? record?.data ?? record?.items ?? payload;

  if (Array.isArray(rawResults)) {
    return rawResults.filter((item): item is ReacherResponse => asRecord(item) !== null);
  }

  const singleResult = asRecord(rawResults);
  return singleResult ? [singleResult] : [];
}

function resultEmail(raw: ReacherResponse): string | null {
  return (
    stringValue(raw.input) ??
    stringValue(raw.email) ??
    stringValue(raw.to_email) ??
    stringValue(raw.address)
  );
}

function isBulkCompleted(status: ReacherBulkStatusResponse): boolean {
  const value = stringValue(status.job_status ?? status.status)?.toLowerCase();
  return value === "completed" || value === "complete" || value === "finished";
}

async function submitReacherBulkJob(jobId: string, emails: string[]): Promise<string> {
  await ensureCanContinue(jobId);

  const payload = await fetchJson<ReacherBulkCreateResponse>(
    config.REACHER_BULK_API_URL,
    {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ input: emails })
    },
    "Reacher bulk submit"
  );

  const remoteJobId = stringValue(payload.job_id);
  if (!remoteJobId) {
    throw new Error("Reacher bulk submit did not return a job_id.");
  }

  await prisma.bulkJob.updateMany({
    where: {
      id: jobId,
      status: { not: JobStatus.CANCELLED }
    },
    data: {
      reacherBulkJobId: remoteJobId,
      reacherBulkSubmittedAt: new Date()
    }
  });

  await ensureCanContinue(jobId);
  return remoteJobId;
}

async function pollReacherBulkJob(
  jobId: string,
  remoteJobId: string,
  baselineProcessed: number,
  totalRecords: number
) {
  const deadline = Date.now() + config.BULK_MAX_WAIT_MINUTES * 60_000;
  let lastProcessed = -1;

  while (Date.now() <= deadline) {
    await ensureCanContinue(jobId);

    const status = await fetchJson<ReacherBulkStatusResponse>(
      bulkJobUrl(remoteJobId),
      {
        method: "GET",
        headers: authHeaders()
      },
      "Reacher bulk status"
    );

    const totalProcessed = numberValue(status.total_processed) ?? 0;
    if (totalProcessed !== lastProcessed) {
      lastProcessed = totalProcessed;
      await prisma.bulkJob.updateMany({
        where: {
          id: jobId,
          status: { not: JobStatus.CANCELLED }
        },
        data: {
          processedCount: Math.min(totalRecords, baselineProcessed + totalProcessed)
        }
      });
    }

    if (isBulkCompleted(status)) {
      return;
    }

    await sleepWithStopChecks(jobId, config.BULK_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for Reacher bulk job ${remoteJobId} after ${config.BULK_MAX_WAIT_MINUTES} minutes.`
  );
}

async function fetchAllBulkResults(
  jobId: string,
  remoteJobId: string,
  expectedCount: number
): Promise<ReacherResponse[]> {
  const results: ReacherResponse[] = [];
  let offset = 0;

  while (results.length < expectedCount) {
    await ensureCanContinue(jobId);

    const payload = await fetchJson<unknown>(
      bulkResultsUrl(remoteJobId, config.BULK_RESULTS_PAGE_SIZE, offset),
      {
        method: "GET",
        headers: authHeaders()
      },
      "Reacher bulk results"
    );

    const batch = extractBulkResults(payload);
    if (batch.length === 0) {
      break;
    }

    results.push(...batch);
    offset += batch.length;

    if (batch.length < config.BULK_RESULTS_PAGE_SIZE) {
      break;
    }
  }

  return results;
}

async function saveBulkResults(
  jobId: string,
  pendingResults: PendingEmailResult[],
  rawResults: ReacherResponse[]
) {
  await ensureCanContinue(jobId);

  const pendingByNormalizedEmail = new Map(
    pendingResults.map((result) => [result.normalizedEmail, result])
  );
  const savedIds = new Set<string>();
  const operations: Prisma.PrismaPromise<unknown>[] = [];

  const flush = async () => {
    if (operations.length === 0) {
      return;
    }
    const batch = operations.splice(0, operations.length);
    await prisma.$transaction(batch);
    await ensureCanContinue(jobId);
  };

  for (const [index, raw] of rawResults.entries()) {
    const inputEmail = resultEmail(raw);
    const matchedResult = inputEmail
      ? pendingByNormalizedEmail.get(normalizeEmail(inputEmail))
      : undefined;
    const target = matchedResult ?? pendingResults[index];

    if (!target || savedIds.has(target.id)) {
      continue;
    }

    const normalized = normalizeReacherResult(target.email, raw);
    savedIds.add(target.id);
    operations.push(
      prisma.emailResult.update({
        where: { id: target.id },
        data: {
          status: toPrismaStatus(normalized.status),
          reason: normalized.reason,
          reacherIsReachable: normalized.reacherIsReachable,
          isDisposable: normalized.isDisposable,
          isAcceptAll: normalized.isAcceptAll,
          mxFound: normalized.mxFound,
          smtpResult: normalized.smtpResult,
          rawResponseJson: normalized.rawResponse as Prisma.InputJsonValue,
          checkedAt: new Date(normalized.checkedAt)
        }
      })
    );

    if (operations.length >= 100) {
      await flush();
    }
  }

  const checkedAt = new Date();
  for (const pendingResult of pendingResults) {
    if (savedIds.has(pendingResult.id)) {
      continue;
    }

    operations.push(
      prisma.emailResult.update({
        where: { id: pendingResult.id },
        data: {
          status: EmailStatus.UNKNOWN,
          reason: "No result returned by Reacher bulk job",
          errorMessage: "Reacher bulk results did not include this email.",
          checkedAt
        }
      })
    );

    if (operations.length >= 100) {
      await flush();
    }
  }

  await flush();
  await recomputeJobCounters(jobId, JobStatus.COMPLETED);
}

async function markRemainingUnknownAfterBulkFailure(jobId: string, error: unknown) {
  const currentJob = await prisma.bulkJob.findUnique({
    where: { id: jobId },
    select: { status: true }
  });

  if (!currentJob || currentJob.status === JobStatus.CANCELLED) {
    return;
  }

  const message = error instanceof Error ? error.message : "Bulk verification failed";
  await prisma.emailResult.updateMany({
    where: {
      jobId,
      isDuplicate: false,
      checkedAt: null
    },
    data: {
      status: EmailStatus.UNKNOWN,
      reason: "Bulk verification failed after retry",
      errorMessage: message,
      checkedAt: new Date()
    }
  });

  await recomputeJobCounters(jobId, JobStatus.FAILED, message);
}

async function processBulkVerificationJob(
  queueJob: Job<BulkEmailVerificationJobData, unknown, "verify-bulk-job">
) {
  const jobId = queueJob.data.jobId;

  try {
    const bulkJob = await prisma.bulkJob.findUnique({
      where: { id: jobId }
    });

    if (
      !bulkJob ||
      bulkJob.status === JobStatus.CANCELLED ||
      bulkJob.status === JobStatus.COMPLETED ||
      bulkJob.status === JobStatus.FAILED
    ) {
      return;
    }

    await prisma.bulkJob.updateMany({
      where: {
        id: jobId,
        status: JobStatus.QUEUED
      },
      data: {
        status: JobStatus.PROCESSING,
        startedAt: new Date()
      }
    });

    const pendingResults = await prisma.emailResult.findMany({
      where: {
        jobId,
        isDuplicate: false,
        checkedAt: null
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        normalizedEmail: true
      }
    });

    if (pendingResults.length === 0) {
      await recomputeJobCounters(jobId, JobStatus.COMPLETED);
      return;
    }

    await ensureCanContinue(jobId);

    const baselineProcessed = await processedCountFromResults(jobId);
    const remoteJobId =
      bulkJob.reacherBulkJobId ??
      (await submitReacherBulkJob(
        jobId,
        pendingResults.map((result) => result.email)
      ));

    await pollReacherBulkJob(
      jobId,
      remoteJobId,
      baselineProcessed,
      bulkJob.totalRecords
    );

    const rawResults = await fetchAllBulkResults(jobId, remoteJobId, pendingResults.length);
    await saveBulkResults(jobId, pendingResults, rawResults);
  } catch (error) {
    if (error instanceof JobStoppedError) {
      return;
    }

    const maxAttempts = typeof queueJob.opts.attempts === "number" ? queueJob.opts.attempts : 1;
    const isFinalAttempt = queueJob.attemptsMade + 1 >= maxAttempts;
    if (!isFinalAttempt) {
      throw error;
    }

    await markRemainingUnknownAfterBulkFailure(jobId, error);
  }
}

const worker = new Worker<EmailVerificationJobData, unknown, EmailVerificationJobName>(
  queueName,
  async (queueJob) => {
    if (isLegacyEmailJobData(queueJob.data)) {
      await processLegacyEmailJob(
        queueJob as Job<LegacyEmailVerificationJobData, unknown, "verify-email">
      );
      return;
    }

    await processBulkVerificationJob(
      queueJob as Job<BulkEmailVerificationJobData, unknown, "verify-bulk-job">
    );
  },
  {
    connection: redisConnection,
    concurrency: config.WORKER_CONCURRENCY,
    limiter: {
      max: config.WORKER_RATE_LIMIT_PER_MINUTE,
      duration: 60000
    }
  }
);

worker.on("completed", (job) => {
  console.log(`Verification job completed: ${job.id}`);
});

worker.on("failed", (job, error) => {
  console.error(`Verification job failed: ${job?.id}`, error);
});

async function shutdown() {
  console.log("Shutting down worker");
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(
  `Email verification worker started with concurrency ${config.WORKER_CONCURRENCY} and bulk endpoint ${config.REACHER_BULK_API_URL}`
);
