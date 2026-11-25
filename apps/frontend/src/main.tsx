import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { App } from "./app/App";
import { API_BASE_URL } from "./app/api";
import { AuthProvider } from "./auth/AuthContext";
import { TransactionPinProvider } from "./auth/TransactionPinProvider";
import { SessionIdleGuard } from "./auth/SessionIdleGuard";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./styles.css";
import { applyTheme, getStoredTheme } from "./theme/themeStore";
import { initPwaInstallCapture } from "./pwa/usePwaInstall";
import { bootstrapDocumentBrandingFromCache } from "./lib/documentBranding";

applyTheme(getStoredTheme());
bootstrapDocumentBrandingFromCache(API_BASE_URL);
initPwaInstallCapture();

// Service worker (vite-plugin-pwa → /sw.js). Required for full Chrome installability
// alongside the dynamic tenant manifest; also enables future push if wired later.
registerSW({ immediate: true });

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
