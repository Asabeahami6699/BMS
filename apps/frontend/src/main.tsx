import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";
import { AuthProvider } from "./auth/AuthContext";
import { SessionIdleGuard } from "./auth/SessionIdleGuard";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider } from "./theme/ThemeProvider";
import faviconUrl from "./favIconBms.png";
import "./styles.css";
import { applyTheme, getStoredTheme } from "./theme/themeStore";

applyTheme(getStoredTheme());

const favicon =
  document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement("link");
favicon.rel = "icon";
favicon.type = "image/png";
favicon.href = faviconUrl;
if (!favicon.parentElement) {
  document.head.appendChild(favicon);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <SessionIdleGuard />
            <App />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
