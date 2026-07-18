import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App, { ResultEventCapture } from "./App";
import { ResultScreen } from "./result";
import { RESULT_PREVIEW_GAME } from "./result/preview";
import "./styles.css";

const resultPreview = import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("preview") === "result";

if (resultPreview) document.title = "ROOMMATES — リザルトプレビュー";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {resultPreview ? (
      <ResultScreen
        game={RESULT_PREVIEW_GAME}
        onRestartSameSeed={() => window.location.assign("/")}
        onRestartNewSeed={() => window.location.assign("/")}
        renderEventCapture={(event) => <ResultEventCapture event={event} />}
      />
    ) : <App />}
  </StrictMode>,
);
