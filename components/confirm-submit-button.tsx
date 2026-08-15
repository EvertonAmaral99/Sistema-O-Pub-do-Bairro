"use client";

import type { MouseEvent, ReactNode } from "react";

export function ConfirmSubmitButton({ children, message, className }: { children:ReactNode; message:string; className?:string }) {
  function confirmSubmit(event:MouseEvent<HTMLButtonElement>){
    if(!window.confirm(message)) event.preventDefault();
  }
  return <button className={className} type="submit" onClick={confirmSubmit}>{children}</button>;
}
