"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand";
import { StartDesigningButton } from "@/home/components/cards";
import { editorHref, openSentLink } from "@/home/library";

/**
 * Reads the layout from the link's #fragment (it never reaches a server),
 * saves it in this browser and opens it in Refine. Replacing the URL means
 * Back doesn't return here, and opening the same link again reuses the
 * project it made.
 */
export function StartEntry() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void openSentLink(window.location.hash.slice(1))
      .catch((error) => {
        console.error("Couldn't open the link:", error);
        return null;
      })
      .then((id) => {
        if (cancelled) return;
        if (id) router.replace(editorHref(id, "refine"));
        else setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!failed) {
    return (
      <div className="boot-screen" role="status">
        Opening your layout…
      </div>
    );
  }
  return (
    <main className="start-failed" data-testid="start-failed">
      <div className="start-brand">
        <Logo withName />
      </div>
      <h1>That link didn&rsquo;t open</h1>
      <p>It may have been cut short when it was copied. Send it again from your phone, or start from your rooms here.</p>
      <StartDesigningButton />
    </main>
  );
}
