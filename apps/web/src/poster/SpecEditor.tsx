import type { PosterSpec } from "../api";

type Props = {
  spec: PosterSpec;
  onChange: (spec: PosterSpec) => void;
};

export function SpecEditor({ spec, onChange }: Props) {
  return (
    <div className="spec-editor">
      <div className="eyebrow">Structured prompt</div>
      <textarea
        className="poster-prompt spec-json"
        rows={16}
        value={JSON.stringify(spec, null, 2)}
        onChange={(event) => {
          try {
            onChange(JSON.parse(event.target.value) as PosterSpec);
          } catch {
            // keep typing until the JSON is valid
          }
        }}
      />
      <p className="muted">Edit the JSON before generating. Invalid JSON is ignored until it parses.</p>
    </div>
  );
}
