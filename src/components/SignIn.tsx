import { useState } from 'react';
import { MailCheck, Waypoints } from 'lucide-react';
import { client } from '../supabase';

/**
 * Two ways in.
 *
 * Password is the default because Supabase's built-in email sender allows only
 * two messages an hour, which is trivially easy to exhaust and then locks you
 * out until the window rolls over. Passwords have no such limit.
 *
 * The password never leaves this form for anywhere but Supabase's auth endpoint —
 * it is not stored, logged, or held in component state after submit.
 */
type Mode = 'signin' | 'signup' | 'magic';

export function SignIn() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) return setError('Enter your email address.');
    if (mode !== 'magic' && password.length < 6) {
      return setError('Password needs to be at least 6 characters.');
    }

    setBusy(true);
    setError(null);
    const auth = client().auth;

    try {
      if (mode === 'magic') {
        const { error: err } = await auth.signInWithOtp({
          email: address,
          options: { emailRedirectTo: window.location.origin },
        });
        if (err) throw err;
        setSent(true);
        return;
      }

      const { error: err } =
        mode === 'signup'
          ? await auth.signUp({ email: address, password })
          : await auth.signInWithPassword({ email: address, password });
      if (err) throw err;
      // A session triggers onAuthStateChange in App, which swaps in the workspace.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A rate limit means something tried to send an email. Which knob fixes it
      // depends on what you were doing, so don't give one generic answer.
      if (/rate limit/i.test(message)) {
        setError(
          mode === 'signup'
            ? 'Signup is still sending a confirmation email, and Supabase allows '
              + 'only two an hour. Turn off "Confirm email" in Supabase → '
              + 'Authentication → Providers → Email, then try again — with it off, '
              + 'creating an account sends no email at all.'
            : 'Supabase allows only two emails an hour and that is used up. '
              + 'Sign in with a password instead — that path sends no email.',
        );
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
      setPassword('');
    }
  };

  return (
    <div className="signin">
      <div className="signin-card">
        <h1>
          <Waypoints className="logo" size={18} strokeWidth={2} aria-hidden="true" />
          djtree
        </h1>

        {sent ? (
          <>
            <p className="signin-confirm">
              <MailCheck size={15} aria-hidden="true" />
              Check <b>{email.trim()}</b> for a sign-in link.
            </p>
            <p className="muted small">
              Only two of these can be sent per hour, so use the link rather than
              requesting another.
            </p>
            <button className="ghost block" onClick={() => { setSent(false); setError(null); }}>
              Back
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="muted small signin-intro">
              {mode === 'signup'
                ? 'Pick a password and your library is yours alone — nobody else can read it.'
                : mode === 'magic'
                  ? 'A one-time link, limited to two emails an hour.'
                  : 'Your library is private to your account.'}
            </p>

            <label className="stack">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
              />
            </label>

            {mode !== 'magic' && (
              <label className="stack">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />
              </label>
            )}

            {error && <p className="error">{error}</p>}

            <button className="primary block" type="submit" disabled={busy}>
              {busy
                ? 'Working…'
                : mode === 'signup'
                  ? 'Create account'
                  : mode === 'magic'
                    ? 'Email me a link'
                    : 'Sign in'}
            </button>

            <div className="signin-switch">
              {mode !== 'signup' && (
                <button type="button" className="link" onClick={() => { setMode('signup'); setError(null); }}>
                  Create an account
                </button>
              )}
              {mode !== 'signin' && (
                <button type="button" className="link" onClick={() => { setMode('signin'); setError(null); }}>
                  Sign in with a password
                </button>
              )}
              {mode !== 'magic' && (
                <button type="button" className="link" onClick={() => { setMode('magic'); setError(null); }}>
                  Email a link instead
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
