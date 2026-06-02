import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));
  app.get("/api/health", async () => ({ ok: true }));
}
