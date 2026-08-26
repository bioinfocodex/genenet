import { ReactNode } from 'react';
import '../globals.css';

// Auth pages (login/register/setup) use a bare layout — no sidebar/header
export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
