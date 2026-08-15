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
