import { pool } from '@/lib/db'

let ready: Promise<void> | null = null

// Any fixed number: serialises schema setup across concurrent serverless instances.
const SCHEMA_LOCK_ID = 727274001

/**
 * The project has no migration runner, so create (and extend) the `clip` table on first use.
 * Idempotent and memoized per server instance. Mirrors `clip` in lib/db/schema.ts.
 * Runs in one transaction behind a Postgres advisory lock: without it, two cold starts
 * at the same moment (dashboard + status poll) collided with "deadlock detected" or
 * "duplicate key ... pg_type_typname_nsp_index".
 */
const SCHEMA_SQL = `
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
    ALTER TABLE "clip" ADD COLUMN IF NOT EXISTS "renderUrl" text;
    ALTER TABLE "clip" ADD COLUMN IF NOT EXISTS "hook" text NOT NULL DEFAULT '';
    ALTER TABLE "clip" ADD COLUMN IF NOT EXISTS "description" text NOT NULL DEFAULT '';
    ALTER TABLE "clip" ADD COLUMN IF NOT EXISTS "hashtags" text NOT NULL DEFAULT '';
    ALTER TABLE "clip" ADD COLUMN IF NOT EXISTS "captions" text NOT NULL DEFAULT '';
    ALTER TABLE "clip" ADD COLUMN IF NOT EXISTS "finishing" text NOT NULL DEFAULT '';
    ALTER TABLE "clip" ADD COLUMN IF NOT EXISTS "detail" text NOT NULL DEFAULT '';
    ALTER TABLE "clip" ADD COLUMN IF NOT EXISTS "youtubeCheck" text NOT NULL DEFAULT 'pending';
    ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "rightsSource" text;
    ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "rightsProof" text;
`

async function runSchemaSetup() {
  // Dedicated connection so a failed statement can always be rolled back before the
  // connection goes back to the pool.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT pg_advisory_xact_lock(${SCHEMA_LOCK_ID})`)
    await client.query(SCHEMA_SQL)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

function isRaceError(error: unknown) {
  const code = (error as { code?: string; cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code
  return code === '40P01' || code === '23505' // deadlock_detected, unique_violation
}

export function ensureClipTable() {
  ready ??= runSchemaSetup()
    .catch(async (error) => {
      if (!isRaceError(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
      return runSchemaSetup() // another instance won the race; this pass is a cheap no-op
    })
    .then(() => undefined, (error) => { ready = null; throw error })
  return ready
}
