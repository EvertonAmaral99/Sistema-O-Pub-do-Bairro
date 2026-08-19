import { HelpCourse } from "@/components/help-course";
import { requireUser } from "@/lib/auth";
import { canDownloadFullHelpManual, getHelpChaptersForUser } from "@/lib/help-course-data";
import { roleLabel } from "@/lib/roles";

export const metadata = { title: "Ajuda | O Pub do Bairro" };

export default async function HelpPage() {
  const user = await requireUser();
  const chapters = getHelpChaptersForUser(user);

  return <HelpCourse
    chapters={chapters}
    userId={user.id}
    profileLabel={roleLabel[user.role]}
    canDownloadFullManual={canDownloadFullHelpManual(user)}
  />;
}
