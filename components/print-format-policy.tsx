"use client";

import { useEffect } from "react";

function applyPrintFormatPolicy(root: ParentNode = document) {
  root.querySelectorAll<HTMLSelectElement>('select[name="format"]').forEach((select) => {
    select.querySelectorAll<HTMLOptionElement>('option[value="80"]').forEach((option) => option.remove());
    if (select.value !== "58" && select.value !== "a4") {
      select.value = "58";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  root.querySelectorAll<HTMLAnchorElement>('a[href*="formato=80"]').forEach((link) => {
    try {
      const url = new URL(link.href, window.location.origin);
      if (url.searchParams.get("formato") === "80") {
        url.searchParams.set("formato", "58");
        link.href = `${url.pathname}${url.search}${url.hash}`;
      }
    } catch {
      // Mantém links não reconhecidos intactos.
    }
  });
}

export function PrintFormatPolicy() {
  useEffect(() => {
    applyPrintFormatPolicy();
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) applyPrintFormatPolicy(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
