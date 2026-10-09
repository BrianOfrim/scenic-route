import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ParticipationGate } from "./ParticipationGate";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ParticipationGate><App /></ParticipationGate>
  </StrictMode>,
);
