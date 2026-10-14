import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { unitLabel } from "@/lib/config";
import EnrollForm from "./EnrollForm";

export const runtime = "nodejs";

// Public per-merchant enroll link: /enroll/{slug}
export default async function EnrollPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // "*" so a database without the later columns (loyalty_mode, birthday_reward) still serves the page
  const { data: merchant } = await db
    .from("merchants")
    .select("*")
    .eq("slug", slug)
    .single();

  if (!merchant) notFound();

  return (
    <EnrollForm
      slug={slug}
      merchantName={merchant.name}
      unit={unitLabel(merchant.loyalty_mode, 2)}
      askBirthday={merchant.birthday_reward === true}
    />
  );
}
