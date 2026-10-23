import { ssoEnabled, ssoLabel } from '@/lib/oidc-server';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

/**
 * Whether single sign-on is offered is a property of the deployment, not of
 * the browser, so it is decided here and handed down rather than guessed at
 * in the form.
 */
export default function LoginPage() {
  return <LoginForm sso={{ enabled: ssoEnabled(), label: ssoLabel() }} />;
}
