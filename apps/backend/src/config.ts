import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  REACHER_API_URL: z
    .string()
    .url()
    .default("https://verify.arkentechsolutions.com/v1/check_email"),
  REACHER_API_TOKEN: z.string().optional().default(""),
  REACHER_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(35000),
  CORS_ORIGIN: z.string().default("https://nobounce.arkentechsolutions.com"),
  API_ACCESS_TOKEN: z.string().optional().default(""),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024)
});

export const config = envSchema.parse(process.env);

export const allowedOrigins = config.CORS_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
