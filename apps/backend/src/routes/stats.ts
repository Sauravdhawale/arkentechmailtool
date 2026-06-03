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
    const [bulkGroups, bulkDisposable, duplicateEmails, bulkRiskyOrAcceptAll] =
      await Promise.all([
        prisma.emailResult.groupBy({
          by: ["status"],
          _count: { _all: true },
          where: { jobId: { not: null }, isDuplicate: false, checkedAt: { not: null } }
        }),
        prisma.emailResult.count({
          where: { jobId: { not: null }, isDisposable: true, checkedAt: { not: null } }
        }),
        prisma.emailResult.count({
          where: { jobId: { not: null }, isDuplicate: true }
        }),
        prisma.emailResult.count({
          where: {
            jobId: { not: null },
            isDuplicate: false,
            checkedAt: { not: null },
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
    counts.riskyEmails = bulkRiskyOrAcceptAll;
    counts.disposableEmails = bulkDisposable;
    counts.duplicateEmails = duplicateEmails;

    return counts;
  });
}
