"use client";
import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  function toggle() {
    const current =
      dark ?? window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = current ? "light" : "dark";
    setDark(!current);
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="Toggle light or dark appearance"
      title="Toggle appearance"
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
