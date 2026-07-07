/**
 * Sign-in screen — the gate in front of the app (PRD user stories 1, 2).
 * Two passwordless paths: Google OAuth and an emailed magic link. No password
 * field exists anywhere by design. On success Better Auth sets the session
 * cookie and the session hook in App re-renders into the dashboard.
 *
 * The magic-link and Google flows both redirect back to the app's own origin
 * after the server completes auth.
 */
import { useState } from 'react';
import { signIn } from './authClient';

const callbackURL = typeof window === 'undefined' ? '/' : window.location.origin;

export function SignIn() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function handleGoogle() {
    setError('');
    await signIn.social({ provider: 'google', callbackURL });
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    setError('');
    const { error: err } = await signIn.magicLink({ email: email.trim(), callbackURL });
    if (err) {
      setStatus('error');
      setError(err.message ?? 'Could not send the sign-in link. Try again.');
    } else {
      setStatus('sent');
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>OAP Contest Manager</h1>
        <p className="subtitle">Sign in to reach your contests.</p>
      </header>

      <div className="signin-card">
        <button className="btn-primary signin-google" onClick={handleGoogle}>
          Continue with Google
        </button>

        <div className="signin-divider">or</div>

        {status === 'sent' ? (
          <p className="signin-sent">
            Check <strong>{email}</strong> for a sign-in link. It expires shortly and can be used once.
          </p>
        ) : (
          <form className="signin-magic" onSubmit={handleMagicLink}>
            <label htmlFor="signin-email">Email me a sign-in link</label>
            <input
              id="signin-email"
              type="email"
              autoComplete="email"
              placeholder="you@school.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="btn-primary" type="submit" disabled={status === 'sending'}>
              {status === 'sending' ? 'Sending…' : 'Send link'}
            </button>
          </form>
        )}

        {status === 'error' && <p className="signin-error">{error}</p>}
      </div>
    </div>
  );
}
