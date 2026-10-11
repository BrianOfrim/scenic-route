import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { submitFeedback } from "./api";

export function FeedbackDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  function close() {
    if (sending) return;
    dialog.current?.close();
    onClose();
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (sending || sent || !message.trim()) return;
    setSending(true);
    setError(null);
    try {
      await submitFeedback(message);
      setSent(true);
      setMessage("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not send your feedback. Please try again.");
    } finally { setSending(false); }
  }

  return <dialog ref={dialog} className="account-settings-dialog feedback-dialog" aria-labelledby={`${id}-title`}
    onCancel={event => { event.preventDefault(); close(); }}>
    <form onSubmit={event => void send(event)}>
      <div className="account-settings-header">
        <h2 id={`${id}-title`}>Feedback &amp; suggestions</h2>
        <button type="button" className="text-btn" disabled={sending} onClick={close}>Close</button>
      </div>
      {sent ? <>
        <p role="status">Thanks! Your feedback has been sent to the Scenic Route team.</p>
        <button type="button" className="button" onClick={close} autoFocus>Done</button>
      </> : <>
        <p className="muted">Have an idea, found a problem, or want to share what’s working? We’d love to hear from you.</p>
        <label className="poster-field" htmlFor={`${id}-message`}>Your message
          <textarea id={`${id}-message`} className="search" rows={7} required maxLength={5000} autoFocus
            disabled={sending} value={message} aria-describedby={`${id}-help ${id}-count`}
            placeholder="Tell us what you think…" onChange={event => setMessage(event.target.value)} />
        </label>
        <p id={`${id}-count`} className="muted feedback-count">{message.length.toLocaleString()} / 5,000</p>
        <p id={`${id}-help`} className="muted">Sent to info@scenic-route.ca with your account email ({email}) so we can reply.</p>
        {error && <p role="alert">{error}</p>}
        <button type="submit" className="button" disabled={sending || !message.trim()}>{sending ? "Sending…" : "Send feedback"}</button>
        <p className="muted">You can also <a href="mailto:info@scenic-route.ca?subject=Scenic%20Route%20feedback">email us directly</a>.</p>
      </>}
    </form>
  </dialog>;
}
