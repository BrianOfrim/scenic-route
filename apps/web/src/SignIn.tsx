import { LegalLinks } from "./LegalLinks";
import { useEffect, useState, type FormEvent, type Ref } from "react";
import {
  fetchAuthConfig, requestPasswordReset, resendVerification, resetPassword,
  SignInError, signInEmail, signInGoogle, signUpEmail,
} from "./api";

type Mode = "signin" | "signup" | "forgot" | "reset";
type Props = { inputRef?: Ref<HTMLInputElement>; reset?: boolean };

export function SignInForm({ inputRef, reset = false }: Props) {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const [mode, setMode] = useState<Mode>(reset ? "reset" : "signin");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [google, setGoogle] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    if (reset && (!token || params.has("error"))) return "This reset link is invalid or expired. Request a new one.";
    if (params.has("error")) return "Sign-in could not be completed. Please try again.";
    return null;
  });

  useEffect(() => {
    let active = true;
    void fetchAuthConfig().then((config) => { if (active) setGoogle(config.google); })
      .catch(() => { if (active) setGoogle(false); });
    return () => { active = false; };
  }, []);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
    setNeedsVerification(false);
    setPassword("");
    setConfirmation("");
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      if (err instanceof SignInError && err.code === "EMAIL_NOT_VERIFIED") {
        setNeedsVerification(true);
        setError("Verify your email before signing in. Check your inbox for a verification link.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if ((mode === "signup" || mode === "reset") && password !== confirmation) {
      setError("Passwords don’t match.");
      return;
    }
    await run(async () => {
      if (mode === "signin") {
        await signInEmail(email.trim(), password);
        window.location.assign("/");
      } else if (mode === "signup") {
        await signUpEmail(name.trim(), email.trim(), password);
        setPassword("");
        setConfirmation("");
        setNeedsVerification(true);
        setNotice("Check your inbox to verify your email, then sign in to see your beta admission or waitlist status. If you already have an account, sign in or reset your password.");
      } else if (mode === "forgot") {
        await requestPasswordReset(email.trim());
        setNotice("If an account exists for this email, you’ll receive a password reset link. Check your inbox.");
      } else {
        if (!token) throw new Error("Request a new password reset link.");
        await resetPassword(token, password);
        window.history.replaceState({}, "", "/");
        switchMode("signin");
        setNotice("Your password has been updated. Sign in with your new password.");
      }
    });
  }

  const title = { signin: "Sign in", signup: "Create account", forgot: "Reset your password", reset: "Choose a new password" }[mode];
  return (
    <div className="auth-card">
      <h2>{title}</h2>
      {(mode === "signup" || mode === "signin") && <p className="auth-hint">Limited public beta.</p>}
      {(mode === "signin" || mode === "signup") && <>
        <button type="button" className="button google-sign-in" disabled={busy || !google}
          onClick={() => void run(signInGoogle)}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48">
            <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.7c3.9-3.6 6-8.9 6-15Z" />
            <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.7-5.1c-1.8 1.2-4.1 2-6.8 2-5.3 0-9.8-3.6-11.4-8.4H5.7v5.3A20.4 20.4 0 0 0 24 44Z" />
            <path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.7a20 20 0 0 0 0 17.8Z" />
            <path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3l5.9-5.9A19.8 19.8 0 0 0 24 4 20.4 20.4 0 0 0 5.7 15.1l6.9 5.3C14.2 15.6 18.7 12 24 12Z" />
          </svg>
          {busy ? "Please wait…" : "Continue with Google"}
        </button>
        {google === false && <p className="auth-hint">Google sign-in isn’t available yet. Use email below.</p>}
        <div className="auth-divider"><span>or use email</span></div>
      </>}
      {(mode === "signup" || mode === "signin") && <LegalLinks />}
      <form className="sign-in-form" onSubmit={(event) => void handleSubmit(event)}>
        {mode === "signup" && <label>Name
          <input autoComplete="name" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} required disabled={busy} />
        </label>}
        {mode !== "reset" && <label>Email
          <input ref={inputRef} type="email" autoComplete="email" placeholder="you@example.com"
            value={email} onChange={(event) => setEmail(event.target.value)} required disabled={busy} />
        </label>}
        {mode !== "forgot" && <label>{mode === "reset" ? "New password" : "Password"}
          <input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password} onChange={(event) => setPassword(event.target.value)} required
            minLength={mode === "signin" ? undefined : 8} maxLength={128} disabled={busy} />
        </label>}
        {(mode === "signup" || mode === "reset") && <>
          <p className="auth-hint">Use at least 8 characters.</p>
          <label>Confirm password
            <input type="password" autoComplete="new-password" value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)} required minLength={8} maxLength={128} disabled={busy} />
          </label>
        </>}
        <button type="submit" className="button" disabled={busy || (mode === "reset" && (!token || params.has("error")))}>
          {busy ? "Please wait…" : mode === "forgot" ? "Send reset link" : mode === "reset" ? "Save password" : title}
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      {needsVerification && <button type="button" className="text-btn" disabled={busy} onClick={() => void run(async () => {
        await resendVerification(email.trim());
        setNotice("If your account needs verification, a new link has been sent. Check your inbox.");
      })}>Resend verification email</button>}
      <div className="auth-links">
        {mode === "signin" ? <>
          <button type="button" className="text-btn" disabled={busy} onClick={() => switchMode("signup")}>Create account</button>
          <button type="button" className="text-btn" disabled={busy} onClick={() => switchMode("forgot")}>Forgot password?</button>
        </> : <button type="button" className="text-btn" disabled={busy} onClick={() => switchMode("signin")}>Back to sign in</button>}
        {mode === "reset" && <button type="button" className="text-btn" disabled={busy} onClick={() => switchMode("forgot")}>Request a new reset link</button>}
      </div>
    </div>
  );
}
