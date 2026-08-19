import { HelpCourse } from "@/components/help-course";
import { requireUser } from "@/lib/auth";

export const metadata={title:"Ajuda | O Pub do Bairro"};

export default async function HelpPage(){
  await requireUser();
  return <HelpCourse/>;
}
