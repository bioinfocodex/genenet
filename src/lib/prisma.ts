import { PrismaClient } from '@prisma/client';
import { describeDatabaseLocationRisk } from '@/lib/db-location';
import { auditExtension } from '@/lib/audit';

const globalForPrisma = global as unknown as {
  prisma: ReturnType<typeof build>;
  prismaBase: PrismaClient;
  genenetLocationWarned: boolean;
};

// An existing install may already be pointed at a synced folder, so this warns
// rather than refuses -- refusing would lock a lab out of its own records at
// the worst possible moment. New installs cannot reach that state: setup routes
// the database to local storage regardless of where uploads go.
// Printed once per process rather than once per hot reload.
if (!globalForPrisma.genenetLocationWarned) {
  const risk = describeDatabaseLocationRisk(process.env.DATABASE_URL);
  if (risk) console.warn(risk);
  globalForPrisma.genenetLocationWarned = true;
}

/**
 * Who is making this change, for the audit trail.
 *
 * Imported lazily because auth-guard imports this module: taking the dependency
 * at call time rather than load time keeps the cycle from biting. Anything that
 * writes outside a request -- the backup scheduler, a seed script -- has no
 * session, and is recorded with a null actor rather than being refused.
 */
async function resolveActor(): Promise<{ id: string | null; email: string | null }> {
  try {
    // An API request has no session, but it does have a token, and every token
    // belongs to a person. Checking this first means "the API changed it" is
    // never the answer to who changed a record.
    const { currentApiActor } = await import('@/lib/api-auth');
    const viaToken = currentApiActor();
    if (viaToken) return { id: viaToken.userId, email: viaToken.userEmail };
  } catch { /* not an API request */ }

  try {
    const { getCurrentUser } = await import('@/lib/auth-guard');
    const user = await getCurrentUser();
    return { id: user?.id ?? null, email: user?.email ?? null };
  } catch {
    return { id: null, email: null };
  }
}

function build() {
  const base = globalForPrisma.prismaBase ?? new PrismaClient();
  globalForPrisma.prismaBase = base;
  return auditExtension(base, resolveActor);
}

/**
 * The audited client. Everything in the application imports this, so every
 * write is recorded without the caller doing anything.
 */
export const prisma = globalForPrisma.prisma ?? build();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
