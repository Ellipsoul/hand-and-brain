"use client";

import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import type { Lobby, LobbyRoles, Player, Role, Team } from "@/lib/types";

/**
 * Lobby page: shows current players, roles, and lets a player choose a role with
 * server-side conflict checks and a 3-second debounce.
 */
export default function LobbyPage(): ReactElement {
  const params = useParams<{ lobbyId: string }>();
  const router = useRouter();
  const lobbyId = params.lobbyId;

  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);

  // Client identity
  const playerId = useMemo<string>(() => {
    if (typeof window === "undefined") return "";
    let id = localStorage.getItem("hab:playerId");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("hab:playerId", id);
    }
    return id;
  }, []);
  const name = useMemo<string>(() => {
    if (typeof window === "undefined") return "";
    const n = localStorage.getItem("hab:name") || "";
    if (!n) router.push("/");
    return n;
  }, [router]);

  // Local debounce guard (server also enforces)
  const [lastChangeAt, setLastChangeAt] = useState<number>(0);

  const fetchLobby = useCallback(async (): Promise<void> => {
    const res = await fetch(`/api/lobbies/${lobbyId}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to fetch lobby");
    } else {
      setLobby(data.lobby as Lobby);
    }
  }, [lobbyId]);

  // Ensure we are in the lobby (idempotent join)
  const ensureJoined = useCallback(async (): Promise<void> => {
    await fetch(`/api/lobbies/${lobbyId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player: { id: playerId, name } }),
    });
  }, [lobbyId, playerId, name]);

  useEffect(() => {
    if (!lobbyId || !playerId) return;
    (async () => {
      await ensureJoined();
      await fetchLobby();
    })();
    const t = setInterval(fetchLobby, 3000);
    return () => clearInterval(t);
  }, [lobbyId, playerId, ensureJoined, fetchLobby]);

  function occupantName(id?: string): string {
    if (!id || !lobby) return "Empty";
    const p = lobby.players.find((x) => x.id === id);
    return p ? p.name : "Unknown";
  }

  function spectators(): Player[] {
    if (!lobby) return [];
    const roleIds = new Set<string>(
      Object.values(lobby.roles || ({} as LobbyRoles)).filter((
        v,
      ): v is string => Boolean(v)),
    );
    return lobby.players.filter((p) => !roleIds.has(p.id));
  }

  const trySelect = async (
    sel: { team: Team; role: Role } | null,
  ): Promise<void> => {
    if (busy) return;
    const now = Date.now();
    if (now - lastChangeAt < 3000) return; // client guard
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lobbies/${lobbyId}/role`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId, selection: sel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to change role");
      } else {
        setLobby(data.lobby as Lobby);
        setLastChangeAt(now);
      }
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 px-4 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Lobby</h1>
            <p className="text-sm text-neutral-400 break-all">{lobbyId}</p>
          </div>
          <div className="text-sm text-neutral-400">
            Signed in as{" "}
            <span className="text-neutral-200 font-medium">{name}</span>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
            <h2 className="text-sm font-medium text-neutral-300">White</h2>
            <div className="mt-3 grid gap-2">
              <button
                className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-left hover:bg-neutral-900"
                onClick={() => trySelect({ team: "WHITE", role: "HAND" })}
                disabled={busy}
                aria-disabled={busy}
              >
                <div className="text-xs text-neutral-500">Hand</div>
                <div className="text-neutral-200">
                  {occupantName(lobby?.roles.whiteHand)}
                </div>
              </button>
              <button
                className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-left hover:bg-neutral-900"
                onClick={() => trySelect({ team: "WHITE", role: "BRAIN" })}
                disabled={busy}
                aria-disabled={busy}
              >
                <div className="text-xs text-neutral-500">Brain</div>
                <div className="text-neutral-200">
                  {occupantName(lobby?.roles.whiteBrain)}
                </div>
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
            <h2 className="text-sm font-medium text-neutral-300">Spectators</h2>
            <div className="mt-3">
              <ul className="space-y-1 text-sm text-neutral-300">
                {spectators().map((p) => (
                  <li key={p.id} className="flex items-center justify-between">
                    <span>{p.name}</span>
                    {p.id === playerId && (
                      <button
                        className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs hover:bg-neutral-900"
                        onClick={() => trySelect(null)}
                        disabled={busy}
                      >
                        Stay spectator
                      </button>
                    )}
                  </li>
                ))}
                {spectators().length === 0 && (
                  <li className="text-neutral-500">No spectators</li>
                )}
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
            <h2 className="text-sm font-medium text-neutral-300">Black</h2>
            <div className="mt-3 grid gap-2">
              <button
                className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-left hover:bg-neutral-900"
                onClick={() => trySelect({ team: "BLACK", role: "HAND" })}
                disabled={busy}
                aria-disabled={busy}
              >
                <div className="text-xs text-neutral-500">Hand</div>
                <div className="text-neutral-200">
                  {occupantName(lobby?.roles.blackHand)}
                </div>
              </button>
              <button
                className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-left hover:bg-neutral-900"
                onClick={() => trySelect({ team: "BLACK", role: "BRAIN" })}
                disabled={busy}
                aria-disabled={busy}
              >
                <div className="text-xs text-neutral-500">Brain</div>
                <div className="text-neutral-200">
                  {occupantName(lobby?.roles.blackBrain)}
                </div>
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="mt-4 rounded-md border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
