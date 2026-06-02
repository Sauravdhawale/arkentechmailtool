-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('VALID', 'INVALID', 'RISKY', 'UNKNOWN', 'DUPLICATE');

-- CreateTable
CREATE TABLE "BulkJob" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "totalRecords" INTEGER NOT NULL,
    "uniqueEmails" INTEGER NOT NULL,
    "duplicateEmails" INTEGER NOT NULL,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "riskyCount" INTEGER NOT NULL DEFAULT 0,
    "unknownCount" INTEGER NOT NULL DEFAULT 0,
    "disposableCount" INTEGER NOT NULL DEFAULT 0,
    "acceptAllCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailResult" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "domain" TEXT,
    "status" "EmailStatus" NOT NULL DEFAULT 'UNKNOWN',
    "reason" TEXT,
    "reacherIsReachable" TEXT,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOf" TEXT,
    "isDisposable" BOOLEAN NOT NULL DEFAULT false,
    "isAcceptAll" BOOLEAN NOT NULL DEFAULT false,
    "mxFound" BOOLEAN,
    "smtpResult" TEXT,
    "rawResponseJson" JSONB,
    "errorMessage" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualVerificationLog" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "domain" TEXT,
    "status" "EmailStatus" NOT NULL,
    "reason" TEXT,
    "reacherIsReachable" TEXT,
    "isDisposable" BOOLEAN NOT NULL DEFAULT false,
    "isAcceptAll" BOOLEAN NOT NULL DEFAULT false,
    "mxFound" BOOLEAN,
    "smtpResult" TEXT,
    "rawResponseJson" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualVerificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkJob_status_createdAt_idx" ON "BulkJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EmailResult_jobId_status_idx" ON "EmailResult"("jobId", "status");

-- CreateIndex
CREATE INDEX "EmailResult_normalizedEmail_idx" ON "EmailResult"("normalizedEmail");

-- CreateIndex
CREATE INDEX "ManualVerificationLog_status_createdAt_idx" ON "ManualVerificationLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ManualVerificationLog_normalizedEmail_idx" ON "ManualVerificationLog"("normalizedEmail");

-- AddForeignKey
ALTER TABLE "EmailResult" ADD CONSTRAINT "EmailResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BulkJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
