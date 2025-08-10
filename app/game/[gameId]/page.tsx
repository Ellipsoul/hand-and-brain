"use client";

import { useParams } from "next/navigation";
import type { ReactElement } from "react";

/**
 * Placeholder game page. Redirect from lobby start.
 */
export default function GamePage(): ReactElement {
  const params = useParams<{ gameId: string }>();
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 px-4 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-xl font-semibold">Game</h1>
        <p className="mt-2 text-neutral-400">Game ID: {params.gameId}</p>
        <p className="mt-6 text-neutral-300">Board will go here.</p>
      </div>
    </main>
  );
}
