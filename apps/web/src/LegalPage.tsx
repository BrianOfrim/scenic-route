import { Fragment, type ReactNode } from "react";
import { LegalLinks } from "./LegalLinks";

export function legalDocumentPath(path: string): "terms" | "privacy" | null {
  if (/^\/terms\/?$/.test(path)) return "terms";
  if (/^\/privacy\/?$/.test(path)) return "privacy";
  return null;
}

// The policy sources use only headings, paragraphs, and links. React escapes text;
// no raw HTML is rendered and only local, HTTPS, and email links are accepted.
function inline(text: string): ReactNode[] {
  return text.split(/(\[[^\]]+\]\([^)]+\))/g).map((part, index) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link && /^(\/(?!\/)|https:\/\/|mailto:)/.test(link[2])) {
      return <a key={index} href={link[2]}>{link[1]}</a>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export function LegalPage({ document }: { document: string }) {
  const blocks = document.trim().split(/\n\s*\n/);
  const title = blocks[0].replace(/^# /, "");
  return <div className="legal-page">
    <a className="legal-skip" href="#policy-content">Skip to policy</a>
    <header className="legal-header"><a href="/">Scenic Route — home</a><LegalLinks /></header>
    <main id="policy-content" tabIndex={-1}>
      <article aria-labelledby="policy-title">
        <h1 id="policy-title">{title}</h1>
        {blocks.slice(1).map((block, index) => block.startsWith("## ")
          ? <h2 key={index}>{block.slice(3)}</h2>
          : <p key={index}>{inline(block.replace(/\n/g, " "))}</p>)}
      </article>
    </main>
    <footer><LegalLinks /><p>Questions? <a href="mailto:info@scenic-route.ca">info@scenic-route.ca</a></p></footer>
  </div>;
}
