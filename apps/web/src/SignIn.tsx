import { useState, type FormEvent, type Ref } from "react";
import { requestMagicLink } from "./api";

type Props = {
  inputRef?: Ref<HTMLInputElement>;
  onSent?: (email: string) => void;
  onReset?: () => void;
};

export function SignInForm({ inputRef, onSent, onReset }: Props) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
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
      setSent(next);
      onSent?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send sign-in link");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="sign-in-sent" role="status">
        <p>Check your inbox</p>
        <p className="muted">
          We sent a sign-in link to <strong>{sent}</strong>. It expires in a few minutes.
        </p>
        <button type="button" className="text-btn" onClick={() => {
            setSent(null);
            onReset?.();
          }}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form className="sign-in-form" onSubmit={(event) => void handleSubmit(event)}>
      <label>
        <span className="sr-only">Email</span>
        <input
          ref={inputRef}
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      <button type="submit" className="button" disabled={busy || !email.trim()}>
        {busy ? "Sending…" : "Email me a link"}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
