import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import EnrollForm from "./EnrollForm";

export const runtime = "nodejs";

// Public per-merchant enroll link: /enroll/{slug}
export default async function EnrollPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // select("*") so a database without birthday_reward yet still renders
  const { data: merchant } = await db
    .from("merchants")
    .select("*")
    .eq("slug", slug)
    .single();

  if (!merchant) notFound();

  return <EnrollForm slug={slug} merchantName={merchant.name} askBirthday={merchant.birthday_reward === true} />;
}
