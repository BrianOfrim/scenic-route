import { useEffect, useState, type ReactNode } from "react";
import { deleteAccount, fetchSession, signOut, type SessionUser } from "./api";
import { ServiceAgreement } from "./ServiceAgreement";

type Status = { ready: boolean; blocked: boolean; eligible: boolean; termsAccepted: boolean; aiConsented: boolean;
  termsVersion: string | null; aiVersion: string | null; termsUrl: string | null; privacyUrl: string | null };
export function ParticipationGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>();
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [agreement, setAgreement] = useState(false);
  const [deletionEmail, setDeletionEmail] = useState("");
  async function load() {
    const session = await fetchSession(); setUser(session);
    if (!session) return;
    const response = await fetch('/api/participation', { credentials: 'include' });
    if (!response.ok) throw new Error('Could not load account requirements. Please reload.');
    const next: Status = await response.json(); setStatus(next);
    setAgreement(next.eligible && next.termsAccepted && next.aiConsented);
  }
  useEffect(() => {
    void load().catch(e => setError(e.message));
    const listener = () => { void load().catch(e => setError(e.message)); };
    window.addEventListener('participation-required', listener);
    return () => window.removeEventListener('participation-required', listener);
  }, []);
  // Policy routes must remain readable before acceptance; their content is supplied by the policy-page PR.
  if (window.location.pathname === '/reset-password' || (status && [status.termsUrl, status.privacyUrl].includes(window.location.pathname))) return children;
  if (!error && (user === undefined || (user && !status))) return <div className="sign-in">Loading…</div>;
  if (user === null || (status?.ready && !status.blocked && status.eligible && status.termsAccepted && status.aiConsented)) return children;
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save choices.'); }
    finally { setBusy(false); }
  }
  return <div className="sign-in"><div className="auth-card participation-card">
    <h1>Before you continue</h1>
    {status?.blocked ? <p>This account cannot use Scenic Route. Contact info@scenic-route.ca for help.</p> : !status?.ready ?
      <p>Reviewed policies are not available yet. Please check back later.</p> : <form onSubmit={e => {
        e.preventDefault(); if (!agreement) return; void run(async () => {
          const response = await fetch('/api/participation', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eligible: agreement, terms: agreement, ai: agreement, termsVersion: status.termsVersion, aiVersion: status.aiVersion }) });
          const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not save choices.');
          setStatus(result);
        });
      }}>
      <ServiceAgreement accepted={agreement} busy={busy} onChange={setAgreement} termsUrl={status.termsUrl!} privacyUrl={status.privacyUrl!} />
      <button className="button" disabled={busy || !agreement}>{busy ? 'Saving…' : 'Continue'}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    <p><a href="mailto:info@scenic-route.ca">Privacy requests and account help</a></p>
    <button className="text-btn" disabled={busy} onClick={() => void run(async () => { await signOut(); window.location.replace('/'); })}>Sign out</button>
    {user && <details><summary>Delete account</summary><p>Permanently delete your account, activities, posters and associated data. Enter {user.email} to confirm.</p>
      <input type="email" aria-label="Account email to confirm deletion" value={deletionEmail} onChange={e => setDeletionEmail(e.target.value)} />
      <button className="button" disabled={busy || deletionEmail !== user.email} onClick={() => void run(async () => { await deleteAccount(deletionEmail); window.location.replace('/'); })}>Permanently delete account</button>
    </details>}
  </div></div>;
}
