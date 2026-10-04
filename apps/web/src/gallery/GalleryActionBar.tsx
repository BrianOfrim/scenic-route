import type { ReactNode } from "react";
import { ShareButton } from "../share";
import { FavoriteMark } from "./FavoriteMark";
import type { GalleryImage } from "./GalleryViewer";

type Props = {
  image: GalleryImage;
  favorited: boolean;
  onFavorite: () => void;
  onDelete: () => void;
  onVariant: () => void;
  onRefine: () => void;
  onEdit: () => void;
};

function Icon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
}

export function GalleryActionBar({ image, favorited, onFavorite, onDelete, onVariant, onRefine, onEdit }: Props) {
  const favoriteLabel = favorited ? "Remove from favourites" : "Add to favourites";
  return (
    <div className="gallery-action-bar" role="group" aria-label="Image actions" onClick={(event) => event.stopPropagation()}>
      <a className="gallery-icon-action" href={image.src} download={`${image.id}.png`} aria-label="Download" title="Download">
        <Icon><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" /></Icon>
      </a>
      <ShareButton className="gallery-icon-action" url={image.src} filename={`${image.id}.png`}>
        <Icon><path d="M12 15V3m-4 4 4-4 4 4M8 10H5v11h14V10h-3" /></Icon>
      </ShareButton>
      <button type="button" className={`gallery-icon-action ${favorited ? "on" : ""}`} aria-label={favoriteLabel} title={favoriteLabel} aria-pressed={favorited} onClick={onFavorite}>
        <FavoriteMark filled={favorited} />
      </button>
      <span className="gallery-action-divider" aria-hidden="true" />
      <button type="button" className="gallery-icon-action" aria-label="Make new variant" title="Make new variant" onClick={onVariant}>
        <Icon><rect x="3" y="7" width="13" height="14" rx="2" /><path d="M8 3h8m4 0v8m-4-4h8" /></Icon>
      </button>
      <button type="button" className="gallery-icon-action" aria-label="Refine image" title="Refine image" onClick={onRefine}>
        <Icon><path d="m4 20 11-11 3 3L7 23Zm9-9 3 3M6 2v6M3 5h6m10-4v6m-3-3h6" /></Icon>
      </button>
      <button type="button" className="gallery-icon-action" aria-label="Edit setup" title="Edit setup" onClick={onEdit}>
        <Icon><path d="M4 6h5m4 0h7M4 12h11m4 0h1M4 18h1m4 0h11" /><circle cx="11" cy="6" r="2" /><circle cx="17" cy="12" r="2" /><circle cx="7" cy="18" r="2" /></Icon>
      </button>
      <span className="gallery-action-divider" aria-hidden="true" />
      <button type="button" className="gallery-icon-action" aria-label="Delete image" title="Delete image" onClick={onDelete}>
        <Icon><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></Icon>
      </button>
    </div>
  );
}
