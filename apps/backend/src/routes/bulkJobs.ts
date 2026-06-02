import {
  getEmailDomain,
  isValidEmailSyntax,
  normalizeEmail,
  paginationQuerySchema,
  resultFilterSchema
} from "@arken/shared";
import { EmailStatus, JobStatus, type Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { emailVerificationQueue } from "../lib/queue.js";
import { toCsv } from "../lib/csv.js";
import { prisma } from "../lib/prisma.js";
import { serializeEmailResult, serializeJob } from "../lib/serializers.js";
import { parseEmailUpload, UploadValidationError } from "../lib/uploadParser.js";

const jobParamsSchema = z.object({
  jobId: z.string().min(1)
});

const jobListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["queued", "processing", "completed", "failed", "cancelled"]).optional()
});

const resultQuerySchema = paginationQuerySchema.extend({
  status: resultFilterSchema
});

const downloadQuerySchema = z.object({
  filter: z.enum(["all", "valid", "invalid", "unknown_risky"]).default("all")
});

function toPrismaStatus(status: string): EmailStatus {
  return status.toUpperCase() as EmailStatus;
}

function resultWhere(jobId: string, filter: string): Prisma.EmailResultWhereInput {
  const where: Prisma.EmailResultWhereInput = { jobId };

  switch (filter) {
    case "valid":
    case "invalid":
    case "risky":
    case "unknown":
      where.status = toPrismaStatus(filter);
      break;
    case "unknown_risky":
      where.status = { in: [EmailStatus.UNKNOWN, EmailStatus.RISKY] };
      break;
    case "disposable":
      where.isDisposable = true;
      break;
    case "duplicates":
      where.isDuplicate = true;
      break;
  }

  return where;
}

function chartFromJob(job: ReturnType<typeof serializeJob>) {
  return [
    { status: "valid", count: job.validCount },
    { status: "invalid", count: job.invalidCount },
    { status: "risky", count: job.riskyCount },
    { status: "unknown", count: job.unknownCount },
    { status: "disposable", count: job.disposableCount },
    { status: "duplicates", count: job.duplicateEmails }
  ];
}

export async function bulkJobRoutes(app: FastifyInstance) {
  app.post("/api/bulk/jobs", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "Upload a CSV or XLSX file." });
    }

    let parsedUpload;
    try {
      parsedUpload = await parseEmailUpload(file.filename, await file.toBuffer());
    } catch (error) {
      if (error instanceof UploadValidationError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }

    const seen = new Map<string, string>();
    const queued: Array<{ emailResultId: string; email: string }> = [];
    let duplicateRows = 0;
    let invalidRows = 0;
    const now = new Date();

    const resultRows: Prisma.EmailResultCreateManyJobInput[] = parsedUpload.emails.map(
      (email) => {
        const normalizedEmail = normalizeEmail(email);
        const existingId = seen.get(normalizedEmail);
        const base = {
          email,
          normalizedEmail,
          domain: getEmailDomain(normalizedEmail)
        };

        if (existingId) {
          duplicateRows += 1;
          return {
            ...base,
            status: EmailStatus.DUPLICATE,
            isDuplicate: true,
            duplicateOf: existingId,
            reason: "Duplicate email in uploaded file",
            checkedAt: now
          };
        }

        const id = randomUUID();
        seen.set(normalizedEmail, id);

        if (!isValidEmailSyntax(email)) {
          invalidRows += 1;
          return {
            id,
            ...base,
            status: EmailStatus.INVALID,
            reason: "Invalid email syntax",
            checkedAt: now
          };
        }

        queued.push({ emailResultId: id, email });
        return {
          id,
          ...base,
          status: EmailStatus.UNKNOWN
        };
      }
    );

    const initialProcessedCount = duplicateRows + invalidRows;
    const jobStatus = queued.length > 0 ? JobStatus.QUEUED : JobStatus.COMPLETED;

    const job = await prisma.bulkJob.create({
      data: {
        fileName: file.filename,
        status: jobStatus,
        totalRecords: parsedUpload.totalRecords,
        uniqueEmails: parsedUpload.uniqueEmailsToVerify,
        duplicateEmails: duplicateRows,
        processedCount: initialProcessedCount,
        invalidCount: invalidRows,
        completedAt: queued.length > 0 ? null : now,
        results: {
          createMany: {
            data: resultRows
          }
        }
      }
    });

    if (queued.length > 0) {
      await emailVerificationQueue.addBulk(
        queued.map((item) => ({
          name: "verify-email",
          data: {
            jobId: job.id,
            emailResultId: item.emailResultId,
            email: item.email
          },
          opts: {
            jobId: item.emailResultId
          }
        }))
      );
    }

    return reply.code(201).send({
      jobId: job.id,
      status: serializeJob(job).status,
      fileName: job.fileName,
      totalRecords: job.totalRecords,
      duplicateEmails: job.duplicateEmails,
      uniqueEmailsToVerify: job.uniqueEmails
    });
  });

  app.get("/api/bulk/jobs", async (request) => {
    const query = jobListQuerySchema.parse(request.query);
    const where: Prisma.BulkJobWhereInput = query.status
      ? { status: query.status.toUpperCase() as JobStatus }
      : {};
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await Promise.all([
      prisma.bulkJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: query.limit
      }),
      prisma.bulkJob.count({ where })
    ]);

    return {
      items: items.map(serializeJob),
      total,
      page: query.page,
      limit: query.limit
    };
  });

  app.get("/api/bulk/jobs/:jobId", async (request, reply) => {
    const params = jobParamsSchema.parse(request.params);
    const job = await prisma.bulkJob.findUnique({
      where: { id: params.jobId }
    });

    if (!job) {
      return reply.code(404).send({ error: "Job not found." });
    }

    const serialized = serializeJob(job);
    return {
      job: serialized,
      chart: chartFromJob(serialized)
    };
  });

  app.get("/api/bulk/jobs/:jobId/results", async (request, reply) => {
    const params = jobParamsSchema.parse(request.params);
    const query = resultQuerySchema.parse(request.query);
    const jobExists = await prisma.bulkJob.count({ where: { id: params.jobId } });
    if (!jobExists) {
      return reply.code(404).send({ error: "Job not found." });
    }

    const where = resultWhere(params.jobId, query.status);
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      prisma.emailResult.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip,
        take: query.limit
      }),
      prisma.emailResult.count({ where })
    ]);

    return {
      items: items.map(serializeEmailResult),
      total,
      page: query.page,
      limit: query.limit
    };
  });

  app.get("/api/bulk/jobs/:jobId/download", async (request, reply) => {
    const params = jobParamsSchema.parse(request.params);
    const query = downloadQuerySchema.parse(request.query);
    const job = await prisma.bulkJob.findUnique({ where: { id: params.jobId } });
    if (!job) {
      return reply.code(404).send({ error: "Job not found." });
    }

    const rows = await prisma.emailResult.findMany({
      where: resultWhere(params.jobId, query.filter),
      orderBy: { createdAt: "asc" }
    });

    const csv = toCsv(
      rows.map((row) => ({
        email: row.email,
        status: row.status.toLowerCase(),
        reason: row.reason ?? row.errorMessage ?? "",
        domain: row.domain ?? "",
        mx_found: row.mxFound ?? "",
        smtp_result: row.smtpResult ?? "",
        disposable: row.isDisposable,
        checked_at: row.checkedAt?.toISOString() ?? ""
      }))
    );

    const suffix = query.filter === "unknown_risky" ? "unknown-risky" : query.filter;
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="${job.fileName.replace(/\.[^.]+$/, "")}-${suffix}.csv"`
      )
      .send(csv);
  });

  app.post("/api/bulk/jobs/:jobId/cancel", async (request, reply) => {
    const params = jobParamsSchema.parse(request.params);
    const job = await prisma.bulkJob.findUnique({ where: { id: params.jobId } });

    if (!job) {
      return reply.code(404).send({ error: "Job not found." });
    }

    const finalStatuses = new Set<JobStatus>([
      JobStatus.COMPLETED,
      JobStatus.FAILED,
      JobStatus.CANCELLED
    ]);

    if (finalStatuses.has(job.status)) {
      return { job: serializeJob(job) };
    }

    const updated = await prisma.bulkJob.update({
      where: { id: params.jobId },
      data: {
        status: JobStatus.CANCELLED,
        completedAt: new Date()
      }
    });

    return { job: serializeJob(updated) };
  });
}
