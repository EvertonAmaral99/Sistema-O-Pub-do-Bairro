import { PAYMENT_METHOD_VALUES, type BasePaymentMethod, type PaymentMethod } from "@/lib/payments";

export type QuickSalePaymentMethod=PaymentMethod;
export type QuickSalePaymentMode="SINGLE"|"MIXED";
export type QuickSaleFulfillmentType="COUNTER"|"APP_PICKUP";
export type QuickSaleSplitPayment={method:QuickSalePaymentMethod|"";amount:string;staffMemberId:string};

export type QuickSaleCheckoutDraft={
  discount:string;
  service:string;
  paymentMode:QuickSalePaymentMode;
  splitCount:string;
  paymentMethod:QuickSalePaymentMethod|"";
  staffMemberId:string;
  splitPayments:QuickSaleSplitPayment[];
  customerSearch:string;
  selectedCustomerId:string;
  newCustomerOpen:boolean;
  newCustomerName:string;
  newCustomerCpf:string;
  newCustomerContact:string;
  storeCreditAmount:string;
  remainderMethod:BasePaymentMethod|"";
  remainderStaffMemberId:string;
  format:"80"|"58"|"a4";
  fulfillmentType:QuickSaleFulfillmentType;
  courierAppCode:string;
};

const paymentMethods=new Set<QuickSalePaymentMethod>(PAYMENT_METHOD_VALUES);
const remainderMethods=new Set<BasePaymentMethod>(PAYMENT_METHOD_VALUES.filter((method):method is BasePaymentMethod=>method!=="STORE_CREDIT"));

function sourceObject(value:unknown):Record<string,unknown>{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

function textValue(value:unknown,maxLength:number,fallback=""){
  return typeof value==="string"?value.slice(0,maxLength):fallback;
}

function idValue(value:unknown){
  const raw=textValue(value,20).trim();
  return /^\d{1,19}$/.test(raw)&&raw!=="0"?raw:"";
}

function paymentMethodValue(value:unknown):QuickSalePaymentMethod|""{
  return typeof value==="string"&&paymentMethods.has(value as QuickSalePaymentMethod)?value as QuickSalePaymentMethod:"";
}

function remainderMethodValue(value:unknown):BasePaymentMethod|""{
  return typeof value==="string"&&remainderMethods.has(value as BasePaymentMethod)?value as BasePaymentMethod:"";
}

export function emptyQuickSaleCheckoutDraft():QuickSaleCheckoutDraft{
  return{
    discount:"0",service:"0",paymentMode:"SINGLE",splitCount:"1",paymentMethod:"",staffMemberId:"",
    splitPayments:[{method:"",amount:"",staffMemberId:""},{method:"",amount:"",staffMemberId:""}],
    customerSearch:"",selectedCustomerId:"",newCustomerOpen:false,newCustomerName:"",newCustomerCpf:"",newCustomerContact:"",
    storeCreditAmount:"",remainderMethod:"",remainderStaffMemberId:"",format:"58",fulfillmentType:"COUNTER",courierAppCode:"",
  };
}

export function normalizeQuickSaleCheckoutDraft(value:unknown):QuickSaleCheckoutDraft{
  const source=sourceObject(value);
  const paymentMode:QuickSalePaymentMode=source.paymentMode==="MIXED"?"MIXED":"SINGLE";
  const rawSplitPayments=Array.isArray(source.splitPayments)?source.splitPayments.slice(0,10):[];
  const splitPayments=rawSplitPayments.map((entry):QuickSaleSplitPayment=>{
    const payment=sourceObject(entry);
    return{method:paymentMethodValue(payment.method),amount:textValue(payment.amount,20),staffMemberId:idValue(payment.staffMemberId)};
  });
  while(splitPayments.length<2)splitPayments.push({method:"",amount:"",staffMemberId:""});
  const format=source.format==="a4"?"a4":"58";
  return{
    discount:textValue(source.discount,20,"0"),
    service:textValue(source.service,20,"0"),
    paymentMode,
    splitCount:textValue(source.splitCount,3,"1"),
    paymentMethod:paymentMethodValue(source.paymentMethod),
    staffMemberId:idValue(source.staffMemberId),
    splitPayments,
    customerSearch:textValue(source.customerSearch,120),
    selectedCustomerId:idValue(source.selectedCustomerId),
    newCustomerOpen:source.newCustomerOpen===true,
    newCustomerName:textValue(source.newCustomerName,120),
    newCustomerCpf:textValue(source.newCustomerCpf,14),
    newCustomerContact:textValue(source.newCustomerContact,120),
    storeCreditAmount:textValue(source.storeCreditAmount,20),
    remainderMethod:remainderMethodValue(source.remainderMethod),
    remainderStaffMemberId:idValue(source.remainderStaffMemberId),
    format,
    fulfillmentType:source.fulfillmentType==="APP_PICKUP"?"APP_PICKUP":"COUNTER",
    courierAppCode:textValue(source.courierAppCode,40),
  };
}

export function quickSalePendingLabel(id:number){
  return`VR-${Math.max(0,Math.trunc(id)).toString().padStart(6,"0")}`;
}
