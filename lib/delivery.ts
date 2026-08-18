export type DeliveryStatus="PREPARING"|"READY"|"COLLECTED"|"CANCELLED";

export const deliveryStatusLabel:Record<DeliveryStatus,string>={
  PREPARING:"Em preparo",
  READY:"Pronto para retirada",
  COLLECTED:"Retirado",
  CANCELLED:"Cancelado",
};

export function deliveryOrderLabel(id:number){
  return`DEL-${Math.max(0,Math.trunc(id)).toString().padStart(6,"0")}`;
}

export function courierText(value:FormDataEntryValue|null,maxLength:number){
  const normalized=String(value??"").trim().replace(/\s+/g," ").toLocaleUpperCase("pt-BR");
  if(normalized.length>maxLength)throw new Error(`O campo deve ter no máximo ${maxLength} caracteres.`);
  return normalized;
}
