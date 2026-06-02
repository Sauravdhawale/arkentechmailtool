import { Queue } from "bullmq";
import { config } from "../config.js";

export const emailVerificationQueueName = "email-verification";

export type EmailVerificationJobData = {
  jobId: string;
  emailResultId: string;
  email: string;
};

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

export const redisConnection = connectionOptions(config.REDIS_URL);

export const emailVerificationQueue = new Queue<
  EmailVerificationJobData,
  unknown,
  "verify-email"
>(
  emailVerificationQueueName,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 30000
      },
      removeOnComplete: {
        age: 86400,
        count: 5000
      },
      removeOnFail: {
        age: 604800,
        count: 10000
      }
    }
  }
);
