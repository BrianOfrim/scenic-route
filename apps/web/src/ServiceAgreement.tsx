type Props = {
  accepted: boolean;
  busy: boolean;
  onChange: (accepted: boolean) => void;
  termsUrl?: string;
  privacyUrl?: string;
};

export function ServiceAgreement({ accepted, busy, onChange, termsUrl = "/terms", privacyUrl = "/privacy" }: Props) {
  return <div>
    <p>To create your poster, we send route-derived images and your selected text to external AI services. When refining, we send your current poster too. See our <a href={privacyUrl} target="_blank" rel="noreferrer">Privacy Policy</a> for details.</p>
    <label><input type="checkbox" checked={accepted} disabled={busy} onChange={event => onChange(event.target.checked)} /> I confirm I’m at least 13 years of age, agree to the <a href={termsUrl} target="_blank" rel="noreferrer">Terms</a>, and consent to the AI processing described above.</label>
  </div>;
}
