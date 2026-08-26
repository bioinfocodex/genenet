import './globals.css';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import { ReactNode } from 'react';
import { isSetupComplete, getMockUser } from '@/app/actions/auth';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

export const metadata = {
  title: 'GeneNet | Premium Lab Network',
  description: 'Genetic Engineering Lab Management Platform',
};

const AUTH_PATHS = ['/login', '/register', '/setup', '/connect', '/download'];

export default async function RootLayout({ children }: { children: ReactNode }) {
  const headersList = await headers();
  const pathname = headersList.get('x-pathname') ?? '/';

  const isAuthPage = AUTH_PATHS.some(p => pathname.startsWith(p));

  // Auth pages: bare layout, no redirects
  if (isAuthPage) {
    return (
      <html lang="en" suppressHydrationWarning>
        <body suppressHydrationWarning>{children}</body>
      </html>
    );
  }

  // Protected pages: check setup + session
  const setupDone = await isSetupComplete();
  if (!setupDone) redirect('/setup');

  const user = await getMockUser();

  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <div className="app-container">
          <Sidebar userRole={user?.role ?? 'MEMBER'} userName={user?.name ?? ''} />
          <div className="main-content">
            <Header user={user} />
            <main className="page-content">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
