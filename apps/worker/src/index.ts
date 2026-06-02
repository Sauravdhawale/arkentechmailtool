import "dotenv/config";
import {
  normalizeReacherResult,
  type NormalizedVerificationResult,
  type ReacherResponse
} from "@arken/shared";
import { EmailStatus, JobStatus, Prisma, PrismaClient } from "@prisma/client";
import { Job, Worker } from "bullmq";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  REACHER_API_URL: z
    .string()
    .url()
    .default("https://verify.arkentechsolutions.com/v1/check_email"),
  REACHER_API_TOKEN: z.string().optional().default(""),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
  WORKER_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(90)
});

const config = envSchema.parse(process.env);
const queueName = "email-verification";

type EmailVerificationJobData = {
  jobId: string;
  emailResultId: string;
  email: string;
};

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

async function verifyEmail(email: string): Promise<NormalizedVerificationResult> {
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

  return normalizeReacherResult(email, (await response.json()) as ReacherResponse);
}

async function incrementJobCounters(
  jobId: string,
  result: Pick<NormalizedVerificationResult, "status" | "isDisposable" | "isAcceptAll">
) {
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

async function markUnknownAfterFinalAttempt(
  queueJob: Job<EmailVerificationJobData, unknown, "verify-email">,
  error: unknown
) {
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

const worker = new Worker<EmailVerificationJobData, unknown, "verify-email">(
  queueName,
  async (queueJob) => {
    const bulkJob = await prisma.bulkJob.findUnique({
      where: { id: queueJob.data.jobId }
    });

    if (!bulkJob || bulkJob.status === JobStatus.CANCELLED) {
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
      await markUnknownAfterFinalAttempt(queueJob, error);
    }
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
  `Email verification worker started with concurrency ${config.WORKER_CONCURRENCY}`
);
