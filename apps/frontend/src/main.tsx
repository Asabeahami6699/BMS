import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { App } from "./app/App";
import { AuthProvider } from "./auth/AuthContext";
import { TransactionPinProvider } from "./auth/TransactionPinProvider";
import { SessionIdleGuard } from "./auth/SessionIdleGuard";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./styles.css";
import { applyTheme, getStoredTheme } from "./theme/themeStore";

applyTheme(getStoredTheme());

// Service worker (vite-plugin-pwa → /sw.js). Required for full Chrome installability
// alongside public/manifest.webmanifest; also enables future push if wired later.
registerSW({ immediate: true });

// Prefer the public BMS favicon used by the PWA manifest / Chrome install.
const favicon =
  document.querySelector<HTMLLinkElement>('link[rel="icon"][href="/favicon.png"]') ??
  document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
  document.createElement("link");
favicon.rel = "icon";
favicon.type = "image/png";
favicon.href = "/favicon.png";
if (!favicon.parentElement) {
  document.head.appendChild(favicon);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <TransactionPinProvider>
              <SessionIdleGuard />
              <App />
            </TransactionPinProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
