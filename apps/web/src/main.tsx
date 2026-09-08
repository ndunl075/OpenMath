import { render } from "preact";
import { App } from "./app.js";
import "./styles/global.css";
import "./styles/app.css";

const root = document.getElementById("app");
if (root) render(<App />, root);

// Offline support. Registration failing is not worth telling anyone about; the
// app works online regardless.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
