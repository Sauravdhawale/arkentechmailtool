import { EmailStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";

type Counts = {
  totalVerified: number;
  validEmails: number;
  invalidEmails: number;
  riskyEmails: number;
  unknownEmails: number;
  disposableEmails: number;
  duplicateEmails: number;
};

function emptyCounts(): Counts {
  return {
    totalVerified: 0,
    validEmails: 0,
    invalidEmails: 0,
    riskyEmails: 0,
    unknownEmails: 0,
    disposableEmails: 0,
    duplicateEmails: 0
  };
}

export async function statsRoutes(app: FastifyInstance) {
  app.get("/api/stats", async () => {
    const [
      bulkGroups,
      manualGroups,
      bulkDisposable,
      manualDisposable,
      duplicateEmails,
      bulkRiskyOrAcceptAll,
      manualRiskyOrAcceptAll
    ] = await Promise.all([
        prisma.emailResult.groupBy({
          by: ["status"],
          _count: { _all: true },
          where: { isDuplicate: false, checkedAt: { not: null } }
        }),
        prisma.manualVerificationLog.groupBy({
          by: ["status"],
          _count: { _all: true }
        }),
        prisma.emailResult.count({
          where: { isDisposable: true }
        }),
        prisma.manualVerificationLog.count({
          where: { isDisposable: true }
        }),
        prisma.emailResult.count({
          where: { isDuplicate: true }
        }),
        prisma.emailResult.count({
          where: {
            isDuplicate: false,
            checkedAt: { not: null },
            OR: [{ status: EmailStatus.RISKY }, { isAcceptAll: true }]
          }
        }),
        prisma.manualVerificationLog.count({
          where: {
            OR: [{ status: EmailStatus.RISKY }, { isAcceptAll: true }]
          }
        })
      ]);

    const counts = emptyCounts();
    const applyStatusCount = (status: EmailStatus, count: number) => {
      switch (status) {
        case EmailStatus.VALID:
          counts.validEmails += count;
          counts.totalVerified += count;
          break;
        case EmailStatus.INVALID:
          counts.invalidEmails += count;
          counts.totalVerified += count;
          break;
        case EmailStatus.RISKY:
          counts.riskyEmails += count;
          counts.totalVerified += count;
          break;
        case EmailStatus.UNKNOWN:
          counts.unknownEmails += count;
          counts.totalVerified += count;
          break;
        case EmailStatus.DUPLICATE:
          counts.duplicateEmails += count;
          break;
      }
    };

    bulkGroups.forEach((group) => applyStatusCount(group.status, group._count._all));
    manualGroups.forEach((group) => applyStatusCount(group.status, group._count._all));
    counts.riskyEmails = bulkRiskyOrAcceptAll + manualRiskyOrAcceptAll;
    counts.disposableEmails = bulkDisposable + manualDisposable;
    counts.duplicateEmails = duplicateEmails;

    return counts;
  });
}
