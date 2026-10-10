"use client";
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const media = () => window.matchMedia("(prefers-color-scheme: dark)");
function isDark() {
  const theme = document.documentElement.dataset.theme;
  return theme ? theme === "dark" : media().matches;
}
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  media().addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media().removeEventListener("change", onChange);
  };
}

export function ThemeToggle({ className }: { className?: string }) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => {
        document.documentElement.dataset.theme = isDark() ? "light" : "dark";
      }}
      aria-label="Toggle light or dark appearance"
      title="Toggle appearance"
      className={className}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
