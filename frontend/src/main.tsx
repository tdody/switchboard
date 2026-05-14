import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/styles.css";

const mount = document.getElementById("app");
if (!mount) throw new Error("missing #app");

createRoot(mount).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
