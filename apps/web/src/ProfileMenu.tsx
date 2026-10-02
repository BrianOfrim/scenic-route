import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { updateAccountName } from "./api";

type Props = {
  email: string;
  name?: string | null;
  onNameSaved: (name: string) => void;
  onSignOut: () => void;
};

export function ProfileMenu({ email, name, onNameSaved, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(name ?? "");
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
    if (!settingsOpen) return;
    const dialog = settingsDialog.current;
    dialog?.showModal();
    nameInput.current?.focus();
    return () => dialog?.close();
  }, [settingsOpen]);

  function closeSettings() {
    if (saving) return;
    setSettingsOpen(false);
    trigger.current?.focus();
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
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
        <span aria-hidden="true">{initial}</span>
      </button>
      {open && (
        <div className="profile-menu-panel" id={menuId} role="menu">
          {name?.trim() && <p className="profile-menu-name">{name.trim()}</p>}
          <p className="profile-menu-email">{email}</p>
          <button type="button" className="text-btn" role="menuitem" onClick={() => {
            setOpen(false);
            setNameDraft(name ?? "");
            setSaveError(null);
            setSettingsOpen(true);
          }}>Settings</button>
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
      {settingsOpen && <dialog ref={settingsDialog} className="account-settings-dialog" aria-labelledby={`${settingsId}-title`}
        onCancel={(event) => { event.preventDefault(); closeSettings(); }}>
        <form onSubmit={(event) => void saveName(event)}>
          <div className="account-settings-header">
            <h2 id={`${settingsId}-title`}>Account settings</h2>
            <button type="button" className="text-btn" disabled={saving} onClick={closeSettings}>Close</button>
          </div>
          <p className="profile-menu-email">{email}</p>
          <label className="poster-field" htmlFor={`${settingsId}-name`}>Name (optional)
            <input ref={nameInput} id={`${settingsId}-name`} className="search" autoComplete="name" maxLength={40}
              value={nameDraft} disabled={saving} placeholder="Your name" aria-describedby={`${settingsId}-help`}
              onChange={(event) => { setNameDraft(event.target.value); setSaveError(null); }} />
          </label>
          <p id={`${settingsId}-help`} className="muted">Used to prefill the people list on new posters. You can edit or remove it on each poster.</p>
          {saveError && <p role="alert">{saveError}</p>}
          <button type="submit" className="button" disabled={saving}>{saving ? "Saving…" : "Save name"}</button>
        </form>
      </dialog>}
    </div>
  );
}
