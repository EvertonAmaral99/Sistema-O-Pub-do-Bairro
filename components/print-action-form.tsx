"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

type PrintActionResult={url?:string;error?:string};
type PrintAction=(formData:FormData)=>Promise<PrintActionResult>;

export function PrintActionForm({action,className,children,onSuccess}:{action:PrintAction;className?:string;children:ReactNode;onSuccess?:()=>void}){
  const router=useRouter();
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");

  async function handleSubmit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(pending)return;
    const form=event.currentTarget;
    if(!form.reportValidity())return;
    const printTab=window.open("about:blank","_blank");
    if(!printTab){setError("O navegador bloqueou a nova guia. Libere os pop-ups deste sistema e tente novamente.");return;}
    printTab.document.title="Preparando impressão";
    printTab.document.body.innerHTML="<p style='font-family:sans-serif;padding:24px'>Preparando impressão...</p>";
    setPending(true);setError("");
    try{
      const result=await action(new FormData(form));
      if(!result.url){printTab.close();setError(result.error||"Não foi possível preparar a impressão.");return;}
      printTab.location.href=new URL(result.url,window.location.origin).toString();
      onSuccess?.();
      router.refresh();
    }catch{
      printTab.close();
      setError("Não foi possível preparar a impressão.");
    }finally{setPending(false);}
  }

  return <form className={className} onSubmit={handleSubmit} aria-busy={pending}>{error&&<div className="alert alert-error">{error}</div>}{children}{pending&&<small className="print-action-pending">Preparando a nova guia de impressão...</small>}</form>;
}
