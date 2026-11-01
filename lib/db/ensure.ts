import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

let ready: Promise<void> | null = null

/**
 * The project has no migration runner, so create the `clip` table on first use.
 * Idempotent and memoized per server instance. Mirrors `clip` in lib/db/schema.ts.
 */
export function ensureClipTable() {
  ready ??= db.execute(sql`
    CREATE TABLE IF NOT EXISTS "clip" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL,
      "userId" text NOT NULL,
      "position" integer NOT NULL,
      "start" integer NOT NULL,
      "duration" integer NOT NULL,
      "title" text NOT NULL,
      "reason" text NOT NULL DEFAULT '',
      "transformation" text NOT NULL,
      "url" text NOT NULL,
      "status" text NOT NULL DEFAULT 'processing',
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS "clip_projectId_idx" ON "clip" ("projectId");
  `).then(() => undefined, (error) => { ready = null; throw error })
  return ready
}
