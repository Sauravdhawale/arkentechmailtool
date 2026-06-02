import type { BulkJob, EmailResult, ManualVerificationLog } from "@prisma/client";

function lowerStatus(status: string): string {
  return status.toLowerCase();
}

export function serializeJob(job: BulkJob) {
  const progress =
    job.totalRecords > 0 ? Math.round((job.processedCount / job.totalRecords) * 100) : 0;

  return {
    id: job.id,
    fileName: job.fileName,
    status: lowerStatus(job.status),
    totalEmails: job.totalRecords,
    uniqueEmails: job.uniqueEmails,
    duplicateEmails: job.duplicateEmails,
    processedEmails: job.processedCount,
    validCount: job.validCount,
    invalidCount: job.invalidCount,
    riskyCount: job.riskyCount,
    unknownCount: job.unknownCount,
    disposableCount: job.disposableCount,
    acceptAllCount: job.acceptAllCount,
    progress,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString()
  };
}

export function serializeEmailResult(result: EmailResult) {
  return {
    id: result.id,
    email: result.email,
    normalizedEmail: result.normalizedEmail,
    domain: result.domain,
    status: lowerStatus(result.status),
    reason: result.reason,
    reacherIsReachable: result.reacherIsReachable,
    isDuplicate: result.isDuplicate,
    duplicateOf: result.duplicateOf,
    isDisposable: result.isDisposable,
    isAcceptAll: result.isAcceptAll,
    mxFound: result.mxFound,
    smtpResult: result.smtpResult,
    errorMessage: result.errorMessage,
    checkedAt: result.checkedAt?.toISOString() ?? null,
    createdAt: result.createdAt.toISOString()
  };
}

export function serializeManualLog(log: ManualVerificationLog) {
  return {
    id: log.id,
    email: log.email,
    normalizedEmail: log.normalizedEmail,
    domain: log.domain,
    status: lowerStatus(log.status),
    reason: log.reason,
    reacherIsReachable: log.reacherIsReachable,
    isDisposable: log.isDisposable,
    isAcceptAll: log.isAcceptAll,
    mxFound: log.mxFound,
    smtpResult: log.smtpResult,
    checkedAt: log.checkedAt.toISOString()
  };
}
