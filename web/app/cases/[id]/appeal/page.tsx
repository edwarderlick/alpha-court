import { redirect } from "next/navigation";

/**
 * The standalone Stitch appeal mock (fake case #8924-A, fake 1,000 GEN
 * bond, static 12h 45m) is not a real filing surface -- AppealPanel on
 * the case-detail page is. Anyone landing here (old links, typed URL)
 * goes to the live case instead of a page that looks like it works and
 * does nothing.
 */
export default async function AppealFlowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/cases/${id}`);
}
