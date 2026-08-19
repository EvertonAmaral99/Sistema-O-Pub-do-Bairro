"use client";

import { useId, useRef, type MouseEvent, type ReactNode } from "react";
import { CircleAlert, X } from "lucide-react";

export function ConfirmSubmitButton({ children, message, className,disabled=false,name,value }: { children:ReactNode; message:string; className?:string;disabled?:boolean;name?:string;value?:string }) {
  const buttonRef=useRef<HTMLButtonElement>(null);
  const dialogRef=useRef<HTMLDialogElement>(null);
  const titleId=useId();

  function askForConfirmation(event:MouseEvent<HTMLButtonElement>){
    event.preventDefault();
    const form=event.currentTarget.form;
    if(form&&!form.reportValidity())return;
    dialogRef.current?.showModal();
  }
  function confirmSubmit(){
    const button=buttonRef.current;
    dialogRef.current?.close();
    if(button?.form)button.form.requestSubmit(button);
  }
  function closeOnBackdrop(event:MouseEvent<HTMLDialogElement>){
    if(event.target===event.currentTarget)event.currentTarget.close();
  }

  const confirmationClass=className?.includes("btn-danger")?"btn btn-danger":"btn btn-primary";
  return <>
    <button ref={buttonRef} className={className} type="submit" onClick={askForConfirmation} disabled={disabled} name={name} value={value}>{children}</button>
    <dialog className="system-dialog confirm-dialog" ref={dialogRef} aria-labelledby={titleId} onClick={closeOnBackdrop}>
      <div className="confirm-dialog-head"><span className="confirm-dialog-icon"><CircleAlert size={22}/></span><div><span className="eyebrow">Confirmação</span><h3 id={titleId}>Confirmar ação</h3></div><button className="priority-dialog-close" type="button" onClick={()=>dialogRef.current?.close()} aria-label="Fechar"><X size={19}/></button></div>
      <p>{message}</p>
      <div className="confirm-dialog-actions"><button className="btn btn-light" type="button" onClick={()=>dialogRef.current?.close()}>Voltar</button><button className={confirmationClass} type="button" onClick={confirmSubmit}>Confirmar</button></div>
    </dialog>
  </>;
}
