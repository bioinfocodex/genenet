import { NextResponse } from 'next/server';
import { RESOURCES } from '@/lib/api-resources';

/**
 * The API index.
 *
 * Deliberately unauthenticated and deliberately the only such route: someone
 * wiring up an instrument needs to see what exists before they have a token,
 * and this exposes only the shape of the interface, never any lab data.
 */
export async function GET() {
  return NextResponse.json({
    name: 'GeneNet API',
    version: 'v1',
    authentication: {
      scheme: 'Bearer',
      header: 'Authorization: Bearer gn_...',
      obtain: 'An admin creates tokens in Admin -> API tokens. The token is shown once.',
      scopes: {
        read: 'GET only',
        write: 'GET, POST and PATCH',
      },
    },
    conventions: {
      list: 'GET /api/v1/{resource}?limit=50&offset=0&q=search',
      read: 'GET /api/v1/{resource}/{id}',
      create: 'POST /api/v1/{resource} with a JSON body',
      update: 'PATCH /api/v1/{resource}/{id} with a JSON body',
      errors: 'Non-2xx responses are {"error": "..."} with a plain-language reason.',
      attribution: 'Writes are recorded in the audit trail against the person the token belongs to.',
    },
    resources: Object.values(RESOURCES).map(r => ({
      path: `/api/v1/${r.path}`,
      fields: r.fields,
      writable: r.writable,
      required: r.required,
      searchable: r.searchable ?? [],
    })),
  });
}
