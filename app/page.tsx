"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

/**
 * Landing page component: lets a user set their name (required),
 * then either create a new lobby or join an existing lobby by code.
 */
export default function Home(): ReactElement {
  const router = useRouter();

  // Persisted player identity (ephemeral until auth is added)
  const [name, setName] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [loadingCreate, setLoadingCreate] = useState<boolean>(false);
  const [loadingJoin, setLoadingJoin] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // Generate or load a client-side player id
  const playerId = useMemo<string>(() => {
    const existing: string | null = typeof window !== "undefined" ? localStorage.getItem("hab:playerId") : null;
    if (existing) return existing;
    const id: string = crypto.randomUUID();
    if (typeof window !== "undefined") localStorage.setItem("hab:playerId", id);
    return id;
  }, []);

  useEffect((): void => {
    const storedName: string | null = typeof window !== "undefined" ? localStorage.getItem("hab:name") : null;
    if (storedName) setName(storedName);
  }, []);

  const disabled: boolean = name.trim().length === 0;

  /** Handle lobby creation flow. */
  const handleCreate = async (): Promise<void> => {
    if (disabled) return;
    setError("");
    setLoadingCreate(true);
    try {
      if (typeof window !== "undefined") localStorage.setItem("hab:name", name.trim());
      const res: Response = await fetch("/api/lobbies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          player: { id: playerId, name: name.trim() },
          baseTimeSeconds: 300,
          incrementSeconds: 2,
        }),
      });
      const data: { lobby?: { id: string }; error?: string } = await res.json();
      if (!res.ok || !data.lobby) throw new Error(data.error || "Failed to create lobby");
      router.push(`/lobby/${data.lobby.id}`);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoadingCreate(false);
    }
  };

  /** Handle join lobby flow by code. */
  const handleJoin = async (): Promise<void> => {
    if (disabled || code.trim().length === 0) return;
    setError("");
    setLoadingJoin(true);
    try {
      if (typeof window !== "undefined") localStorage.setItem("hab:name", name.trim());
      const lobbyId: string = code.trim();
      const res: Response = await fetch(`/api/lobbies/${lobbyId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ player: { id: playerId, name: name.trim() } }),
      });
      const data: { lobby?: { id: string }; error?: string } = await res.json();
      if (!res.ok || !data.lobby) throw new Error(data.error || "Failed to join lobby");
      router.push(`/lobby/${data.lobby.id}`);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoadingJoin(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 shadow-xl">
        <h1 className="text-xl font-semibold tracking-tight">Hand & Brain</h1>
        <p className="mt-1 text-sm text-neutral-400">Realtime chess with roles</p>

        <div className="mt-6">
          <label htmlFor="name" className="block text-sm font-medium text-neutral-300">
            Your name
          </label>
          <input
            id="name"
            value={name}
            onChange={(e): void => setName(e.target.value)}
            placeholder="e.g., Alice"
            className="mt-2 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
            required
          />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3">
          <button
            type="button"
            onClick={handleCreate}
            disabled={disabled || loadingCreate}
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            aria-disabled={disabled || loadingCreate}
          >
            {loadingCreate ? "Creating…" : "Create a Lobby"}
          </button>

          <div className="relative my-2 flex items-center">
            <div className="h-px flex-1 bg-neutral-800" />
            <span className="px-3 text-xs uppercase tracking-wider text-neutral-500">or</span>
            <div className="h-px flex-1 bg-neutral-800" />
          </div>

          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e): void => setCode(e.target.value)}
              placeholder="Lobby code"
              className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button
              type="button"
              onClick={handleJoin}
              disabled={disabled || loadingJoin || code.trim().length === 0}
              className="inline-flex shrink-0 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2 font-medium text-neutral-200 transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              aria-disabled={disabled || loadingJoin || code.trim().length === 0}
            >
              {loadingJoin ? "Joining…" : "Join"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-neutral-500">Your name is stored locally on this device.</p>
      </div>
    </main>
  );
}
