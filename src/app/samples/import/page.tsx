import { requireUser } from '@/lib/auth-guard';
import ImportClient from './client';

export const dynamic = 'force-dynamic';

export default async function ImportSamplesPage() {
  await requireUser();
  return <ImportClient />;
}
