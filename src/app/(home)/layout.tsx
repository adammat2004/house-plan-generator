import { HomeShell } from "@/home/components/HomeShell";
import "./home.css";

export default function HomeLayout({ children }: LayoutProps<"/">) {
  return <HomeShell>{children}</HomeShell>;
}
