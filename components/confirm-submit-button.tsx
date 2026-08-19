"use client";

import type { MouseEvent, ReactNode } from "react";

export function ConfirmSubmitButton({ children, message, className,disabled=false,name,value }: { children:ReactNode; message:string; className?:string;disabled?:boolean;name?:string;value?:string }) {
  function confirmSubmit(event:MouseEvent<HTMLButtonElement>){
    if(!window.confirm(message)) event.preventDefault();
  }
  return <button className={className} type="submit" onClick={confirmSubmit} disabled={disabled} name={name} value={value}>{children}</button>;
}
