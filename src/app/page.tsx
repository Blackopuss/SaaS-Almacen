import { redirect } from "next/navigation";

// Inventory is the main screen. The public landing page arrives in BIL-15.
export default function Home() {
  redirect("/inicio");
}
