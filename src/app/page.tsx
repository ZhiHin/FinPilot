import { redirect } from "next/navigation";

import { getCurrentSession } from "@/server/auth/guard";

export default async function RootPage() {
  const current = await getCurrentSession();
  redirect(current ? "/overview" : "/sign-in");
}
