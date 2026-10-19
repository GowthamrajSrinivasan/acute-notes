import { redirect } from "next/navigation";

/** The app opens directly into the default local workspace. */
export default function Home() {
  redirect("/workspace/default");
}
