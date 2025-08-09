/**
 * KV client wrapper for @vercel/kv.
 * Ensure KV_URL and KV_REST_API_TOKEN (or platform-specific vars) are set in your environment.
 */
import { kv as vercelKv } from "@vercel/kv";

/**
 * Export the KV instance for use in server routes/handlers.
 */
export const kv = vercelKv;
