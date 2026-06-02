import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError } from "fastify";
import { allowedOrigins, config } from "./config.js";
import { bulkJobRoutes } from "./routes/bulkJobs.js";
import { healthRoutes } from "./routes/health.js";
import { statsRoutes } from "./routes/stats.js";
import { verifyRoutes } from "./routes/verify.js";

function tokenFromHeader(value: string | string[] | undefined): string {
  if (!value) {
    return "";
  }

  const raw = Array.isArray(value) ? value[0] : value;
  return raw.startsWith("Bearer ") ? raw.slice("Bearer ".length) : raw;
}

export async function buildApp() {
  const app = Fastify({
    logger: true,
    bodyLimit: config.UPLOAD_MAX_BYTES
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed by CORS"), false);
    },
    credentials: true
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.UPLOAD_MAX_BYTES,
      files: 1
    }
  });

  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!config.API_ACCESS_TOKEN || request.url.startsWith("/health")) {
      return;
    }

    const provided =
      tokenFromHeader(request.headers.authorization) ||
      tokenFromHeader(request.headers["x-api-key"]);

    if (provided !== config.API_ACCESS_TOKEN) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    app.log.error(error);
    if (typeof error.statusCode === "number") {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    return reply.code(500).send({ error: "Internal server error" });
  });

  await app.register(healthRoutes);
  await app.register(statsRoutes);
  await app.register(verifyRoutes);
  await app.register(bulkJobRoutes);

  return app;
}
