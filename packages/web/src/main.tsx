import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@grackle-ai/web-components/src/styles/global.scss";
import App from "./App.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
