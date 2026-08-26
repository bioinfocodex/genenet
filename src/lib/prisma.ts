import { PrismaClient } from '@prisma/client';
import { describeDatabaseLocationRisk } from '@/lib/db-location';

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
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

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
