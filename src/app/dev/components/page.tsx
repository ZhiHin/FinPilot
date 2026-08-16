import { notFound } from "next/navigation";

import { ComponentGallery } from "./gallery";

/** Dev-only design-system gallery: every base component in every state. */
export default function ComponentsDevPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <ComponentGallery />;
}
