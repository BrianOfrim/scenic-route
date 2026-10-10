import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ParticipationGate } from "./ParticipationGate";
import { App } from "./App";
import "./index.css";
import { LegalPage, legalDocumentPath } from "./LegalPage";
import terms from "../../../docs/terms-of-service.md?raw";
import privacy from "../../../docs/privacy-policy.md?raw";

const policy = legalDocumentPath(window.location.pathname);
if (policy) {
  document.title = `${policy === "terms" ? "Terms of Service" : "Privacy Policy"} — Scenic Route`;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {policy ? <LegalPage document={policy === "terms" ? terms : privacy} /> : <ParticipationGate><App /></ParticipationGate>}
  </StrictMode>,
);
