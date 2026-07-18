import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ResultScreen } from "./result";
import { RESULT_PREVIEW_GAME } from "./result/preview";
import "./styles.css";

const showResultPreview = import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("preview") === "result";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {showResultPreview ? <ResultScreen game={RESULT_PREVIEW_GAME} /> : <App />}
  </StrictMode>,
);
