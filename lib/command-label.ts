export type CommandIdentifier = {
  command_number: number | null;
  command_name: string | null;
};

export function commandLabel(command: CommandIdentifier) {
  const name = command.command_name?.trim();
  if (command.command_number && name) return `#${command.command_number} · ${name}`;
  if (name) return name;
  if (command.command_number) return `#${command.command_number}`;
  return "Sem identificação";
}

export type SaleReference=CommandIdentifier&{
  sale_channel?:string|null;
  table_display?:string|null;
};

export function saleReferenceLabel(sale:SaleReference){
  if(sale.sale_channel==="QUICK_SALE")return"Venda rápida";
  return `Comanda ${commandLabel(sale)}${sale.table_display?` · ${sale.table_display}`:""}`;
}
