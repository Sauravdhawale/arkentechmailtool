import { config } from "./config.js";
import { buildApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { emailVerificationQueue } from "./lib/queue.js";

const app = await buildApp();

const shutdown = async () => {
  app.log.info("Shutting down backend");
  await app.close();
  await emailVerificationQueue.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({
  host: "0.0.0.0",
  port: config.PORT
});
