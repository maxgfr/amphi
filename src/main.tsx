import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { persist } from "./data/db.ts";
import { scriptURL } from "./trusted.ts";

// GitHub Pages cannot send frame-ancestors; refuse to run inside a frame.
if (window.top !== window.self) {
  document.documentElement.replaceChildren();
  throw new Error("amphi does not run inside frames");
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);

// Courses are worth keeping: ask the browser not to evict them.
void persist();

const secure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
if ("serviceWorker" in navigator && secure) {
  void navigator.serviceWorker.register(scriptURL("./sw.js"), { scope: "./" }).catch(() => {});
}
