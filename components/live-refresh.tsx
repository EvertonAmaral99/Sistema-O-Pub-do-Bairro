"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function LiveRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      const activeElement=document.activeElement;
      const isEditing=activeElement instanceof HTMLElement&&(
        activeElement.matches("input, textarea, select")||activeElement.isContentEditable
      );
      if(document.visibilityState==="visible"&&!isEditing)router.refresh();
    };
    const timer = window.setInterval(refresh, intervalMs);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [intervalMs, router]);

  return null;
}
