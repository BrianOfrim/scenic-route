import { LegalLinks } from "./LegalLinks";
import { FeedbackDialog } from "./FeedbackDialog";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { deleteAccount, fetchPosterQuota, updateAccountName, type PosterQuota } from "./api";

type Props = {
  email: string;
  waiting?: boolean;
  name?: string | null;
  image?: string | null;
  onNameSaved: (name: string) => void;
  onSignOut: () => void;
};

export function ProfileMenu({ email, name, image, waiting = false, onNameSaved, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [quota, setQuota] = useState<PosterQuota | null>(null);
  const [quotaError, setQuotaError] = useState(false);
  const [nameDraft, setNameDraft] = useState(name ?? "");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const settingsId = useId();
  const initial = (name?.trim()[0] || email.trim()[0] || "?").toUpperCase();

  useEffect(() => {
    if (!settingsOpen || waiting) return;
    let cancelled = false;
    setQuota(null);
    setQuotaError(false);
    void fetchPosterQuota().then(value => { if (!cancelled) setQuota(value); }, () => { if (!cancelled) setQuotaError(true); });
    return () => { cancelled = true; };
  }, [settingsOpen, waiting]);

  useEffect(() => {
    if (!settingsOpen) return;
    const dialog = settingsDialog.current;
    dialog?.showModal();
    nameInput.current?.focus();
    return () => dialog?.close();
  }, [settingsOpen]);

  function closeSettings() {
    if (saving || deleting) return;
    setSettingsOpen(false);
    trigger.current?.focus();
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (saving || deleting) return;
    setSaving(true);
    setSaveError(null);
    try {
      const nextName = await updateAccountName(nameDraft);
      onNameSaved(nextName);
      setNameDraft(nextName);
      settingsDialog.current?.close();
      setSettingsOpen(false);
      trigger.current?.focus();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save your name.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting || deleteEmail !== email) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(deleteEmail);
      // Drop mounted editors, cached responses, and account state after deletion.
      window.location.replace("/");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete your account. Please retry.");
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        ref={trigger}
        type="button"
        className="profile-menu-trigger"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        {image && image !== failedImage ? (
          <img className="profile-menu-avatar" src={image} alt="" width={38} height={38}
            referrerPolicy="no-referrer" onError={() => setFailedImage(image)} />
        ) : <span aria-hidden="true">{initial}</span>}
      </button>
      {open && (
        <div className="profile-menu-panel" id={menuId} role="menu">
          {name?.trim() && <p className="profile-menu-name">{name.trim()}</p>}
          <p className="profile-menu-email">{email}</p>
          <button type="button" className="text-btn" role="menuitem" onClick={() => {
            setOpen(false);
            setDeleteOpen(false);
            setDeleteEmail("");
            setDeleteError(null);
            setNameDraft(name ?? "");
            setSaveError(null);
            setSettingsOpen(true);
          }}>Settings</button>
          <button type="button" className="text-btn" role="menuitem" onClick={() => {
            setOpen(false);
            setFeedbackOpen(true);
          }}>Feedback &amp; suggestions</button>
          <button
            type="button"
            className="text-btn"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
      {feedbackOpen && <FeedbackDialog email={email} onClose={() => {
        setFeedbackOpen(false);
        trigger.current?.focus();
      }} />}
      {settingsOpen && <dialog ref={settingsDialog} className="account-settings-dialog" aria-labelledby={`${settingsId}-title`}
        onCancel={(event) => { event.preventDefault(); closeSettings(); }}>
        <form onSubmit={(event) => void saveName(event)}>
          <div className="account-settings-header">
            <h2 id={`${settingsId}-title`}>Account settings</h2>
            <button type="button" className="text-btn" disabled={saving || deleting} onClick={closeSettings}>Close</button>
          </div>
          <p className="profile-menu-email">{email}</p>
          <button type="button" className="text-btn" onClick={() => {
            setSettingsOpen(false);
            window.dispatchEvent(new Event("participation-required"));
          }}>Eligibility, Terms and AI consent</button>
          <label className="poster-field" htmlFor={`${settingsId}-name`}>Name (optional)
            <input ref={nameInput} id={`${settingsId}-name`} className="search" autoComplete="name" maxLength={40}
              value={nameDraft} disabled={saving || deleting} placeholder="Your name" aria-describedby={`${settingsId}-help`}
              onChange={(event) => { setNameDraft(event.target.value); setSaveError(null); }} />
          </label>
          <p id={`${settingsId}-help`} className="muted">Used to prefill the people list on new posters. You can edit or remove it on each poster.</p>
          <p className="muted" aria-live="polite">
            {waiting ? "Public beta: waitlisted. Poster generation unlocks after admission." : quota ? quota.limit === null ? "Poster generation: unlimited." : <>
              {quota.used} of {quota.limit} posters generated this month. {quota.remaining} remaining.
              {quota.reserved > 0 && ` ${quota.reserved} reserved for requests in progress.`}
              {` Resets ${new Date(quota.resetsAt).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })} (UTC).`}
            </> : quotaError ? "Could not load poster usage." : "Loading poster usage…"}
          </p>
          {saveError && <p role="alert">{saveError}</p>}
          <button type="submit" className="button" disabled={saving || deleting}>{saving ? "Saving…" : "Save name"}</button>
        </form>
        <LegalLinks />
        <section className="account-delete-section" aria-labelledby={`${settingsId}-delete-title`}>
          <h3 id={`${settingsId}-delete-title`}>Delete account</h3>
          <p className="muted">Permanently delete your account, activities, posters, uploaded images, and associated data. This cannot be undone.</p>
          {!deleteOpen ? <button type="button" className="button account-delete-button" disabled={saving || deleting}
            onClick={() => setDeleteOpen(true)}>Delete account…</button> : <>
            <label className="poster-field" htmlFor={`${settingsId}-delete-email`}>Enter {email} to confirm
              <input id={`${settingsId}-delete-email`} className="search" type="email" autoComplete="off"
                value={deleteEmail} disabled={deleting} onChange={event => setDeleteEmail(event.target.value)} />
            </label>
            {deleteError && <p role="alert">{deleteError}</p>}
            {deleting && <p role="status">Deleting your account and data…</p>}
            <div className="account-delete-actions">
              <button type="button" className="text-btn" disabled={deleting} onClick={() => setDeleteOpen(false)}>Cancel</button>
              <button type="button" className="button account-delete-button" disabled={saving || deleting || deleteEmail !== email}
                onClick={() => void handleDelete()}>{deleting ? "Deleting…" : "Permanently delete account"}</button>
            </div>
          </>}
        </section>
      </dialog>}
    </div>
  );
}
