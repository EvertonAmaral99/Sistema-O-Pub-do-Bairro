export function CommandCardIdentifier({commandNumber,commandName}:{commandNumber:number|null;commandName:string|null}){
  const name=commandName?.trim();
  return <span className="command-card-identifier">
    {commandNumber!==null&&<span>#{commandNumber}</span>}
    {commandNumber!==null&&name&&<span aria-hidden="true"> · </span>}
    {name&&<strong>{name}</strong>}
    {commandNumber===null&&!name&&<span>Sem identificação</span>}
  </span>;
}
