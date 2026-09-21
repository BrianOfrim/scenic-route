import { useState, type FormEvent } from "react";
import { requestMagicLink } from "./api";

type Props = {
  onSent?: (email: string) => void;
};

export function SignIn({ onSent }: Props) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const next = email.trim();
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      await requestMagicLink(next);
      setSent(true);
      onSent?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send sign-in link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sign-in">
      <div className="sign-in-card">
        <div className="brand-lockup">
          <img className="brand-mark" src="/logo/sr-path-sage.svg" alt="" width={40} height={40} />
          <p className="brand">Scenic Route</p>
        </div>
        <h1>Sign in</h1>
        {sent ? (
          <p className="muted">Check your inbox for a sign-in link. It expires in a few minutes.</p>
        ) : (
          <>
            <p className="muted">We’ll email you a magic link. After signing in, import activity files from your device.</p>
            <form className="sign-in-form" onSubmit={(event) => void handleSubmit(event)}>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <button type="submit" className="button" disabled={busy || !email.trim()}>
                {busy ? "Sending…" : "Email me a link"}
              </button>
            </form>
          </>
        )}
        {error ? <p className="error">{error}</p> : null}
      </div>
    </div>
  );
}
