import { z } from "zod";

/**
 * Validates Vite environment variables at runtime.
 * Never place business logic here. This exists solely to ensure
 * the app crashes early with a clear error if required ENVs are missing.
 */
const envSchema = z.object({
  VITE_API_URL: z.string().url().default("http://localhost:3000/api/v1"),
  VITE_APP_NAME: z.string().default("CEX POS"),
  VITE_ENVIRONMENT: z.enum(["development", "staging", "production"]).default("development"),
});

const _env = envSchema.safeParse(import.meta.env);

if (!_env.success) {
  console.error("❌ Invalid environment variables:", _env.error.format());
  throw new Error("Invalid environment variables. Check your .env file.");
}

export const ENV = _env.data;
