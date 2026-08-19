export type DeliveryStatus="PREPARING"|"READY"|"COLLECTED"|"CANCELLED";
export type CourierAppCodeState="INFORMED"|"NOT_REQUIRED"|"PENDING";

export const deliveryStatusLabel:Record<DeliveryStatus,string>={
  PREPARING:"Em preparo",
  READY:"Pronto para retirada",
  COLLECTED:"Retirado",
  CANCELLED:"Cancelado",
};

export function deliveryOrderLabel(id:number){
  return`DEL-${Math.max(0,Math.trunc(id)).toString().padStart(6,"0")}`;
}

export function courierAppCodeState(code:string|null|undefined,notRequired:boolean|null|undefined):CourierAppCodeState{
  if(code?.trim())return"INFORMED";
  return notRequired?"NOT_REQUIRED":"PENDING";
}

export function courierAppCodeLabel(code:string|null|undefined,notRequired:boolean|null|undefined){
  const state=courierAppCodeState(code,notRequired);
  if(state==="INFORMED")return code?.trim()||"Pendente";
  return state==="NOT_REQUIRED"?"Sem código":"Pendente";
}

export function courierText(value:FormDataEntryValue|null,maxLength:number){
  const normalized=String(value??"").trim().replace(/\s+/g," ").toLocaleUpperCase("pt-BR");
  if(normalized.length>maxLength)throw new Error(`O campo deve ter no máximo ${maxLength} caracteres.`);
  return normalized;
}
