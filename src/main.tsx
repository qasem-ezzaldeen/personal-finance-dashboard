import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui/Toast";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { initMotion } from "@/lib/motion";
import { initTheme } from "@/lib/theme";
import { App } from "./App";
import "./styles/index.css";

// Theme and animation speed from the last visit, so the first screen already uses them
initTheme();
initMotion();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
});

// GitHub Pages can't route /assets etc. itself: 404.html sends those to index.html as ?p=/assets
const redirect = new URLSearchParams(window.location.search).get("p");
if (redirect) {
  const url = new URL(window.location.href);
  url.searchParams.delete("p");
  window.history.replaceState(null, "", `${import.meta.env.BASE_URL}${redirect.replace(/^\//, "")}${url.search}${url.hash}`);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
