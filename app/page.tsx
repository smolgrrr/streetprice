import { Dashboard } from "./dashboard";
import { dashboardSnapshot, loadSnapshot } from "@/lib/snapshot";

export const revalidate = 300;

export default async function Page() {
  return <Dashboard snapshot={dashboardSnapshot(await loadSnapshot())} />;
}
