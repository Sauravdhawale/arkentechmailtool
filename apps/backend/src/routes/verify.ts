import { singleVerifyRequestSchema } from "@arken/shared";
import { EmailStatus, Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { verifyEmailWithReacher } from "../lib/reacher.js";
import { serializeManualLog } from "../lib/serializers.js";

function toPrismaStatus(status: string): EmailStatus {
  return status.toUpperCase() as EmailStatus;
}

export async function verifyRoutes(app: FastifyInstance) {
  app.post("/api/verify/single", async (request, reply) => {
    const parsed = singleVerifyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid email address.",
        details: parsed.error.flatten()
      });
    }

    const verification = await verifyEmailWithReacher(parsed.data.email);

    const log = await prisma.manualVerificationLog.create({
      data: {
        email: verification.email,
        normalizedEmail: verification.normalizedEmail,
        domain: verification.domain,
        status: toPrismaStatus(verification.status),
        reason: verification.reason,
        reacherIsReachable: verification.reacherIsReachable,
        isDisposable: verification.isDisposable,
        isAcceptAll: verification.isAcceptAll,
        mxFound: verification.mxFound,
        smtpResult: verification.smtpResult,
        rawResponseJson: verification.rawResponse as Prisma.InputJsonValue,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        checkedAt: new Date(verification.checkedAt)
      }
    });

    return {
      result: serializeManualLog(log)
    };
  });
}
