"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function LiveRefresh({ intervalMs = 12000 }: { intervalMs?: number }) {
  const router = useRouter();
  const lastInteractionRef = useRef(Date.now());
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    const effectiveInterval = Math.max(intervalMs, 10000);
    const idleBeforeRefreshMs = 4000;

    const markInteraction = () => {
      lastInteractionRef.current = Date.now();
    };

    const isEditing = () => {
      const activeElement = document.activeElement;
      return activeElement instanceof HTMLElement && (
        activeElement.matches("input, textarea, select, button") || activeElement.isContentEditable
      );
    };

    const refreshIfIdle = () => {
      const now = Date.now();
      const userIsActive = now - lastInteractionRef.current < idleBeforeRefreshMs;
      const refreshedRecently = now - lastRefreshRef.current < effectiveInterval - 250;

      if (
        document.visibilityState !== "visible" ||
        userIsActive ||
        refreshedRecently ||
        isEditing()
      ) return;

      lastRefreshRef.current = now;
      router.refresh();
    };

    const timer = window.setInterval(refreshIfIdle, effectiveInterval);

    const interactionEvents: Array<keyof DocumentEventMap> = [
      "pointerdown",
      "keydown",
      "touchstart",
      "wheel",
    ];

    for (const eventName of interactionEvents) {
      document.addEventListener(eventName, markInteraction, { capture: true, passive: true });
    }

    // Ao voltar para a aba, não atualiza imediatamente. O clique usado para
    // focar a janela precisa acontecer sem disputar com um router.refresh().
    window.addEventListener("focus", markInteraction);
    document.addEventListener("visibilitychange", markInteraction);

    return () => {
      window.clearInterval(timer);
      for (const eventName of interactionEvents) {
        document.removeEventListener(eventName, markInteraction, true);
      }
      window.removeEventListener("focus", markInteraction);
      document.removeEventListener("visibilitychange", markInteraction);
    };
  }, [intervalMs, router]);

  return null;
}
