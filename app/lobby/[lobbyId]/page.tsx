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

  // WebSocket connection
  const wsRef = useMemo<{ current: WebSocket | null }>(
    () => ({ current: null }),
    [],
  );
  const [connected, setConnected] = useState<boolean>(false);

  const connectWs = useCallback((): void => {
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/api/ws`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.addEventListener("open", () => {
      setConnected(true);
      // send join
      ws.send(
        JSON.stringify({
          type: "join",
          lobbyId,
          player: { id: playerId, name },
        }),
      );
    });
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === "lobby") {
          setLobby(msg.lobby as Lobby);
        } else if (msg.type === "joined") {
          setLobby(msg.lobby as Lobby);
        } else if (msg.type === "error") {
          setError(String(msg.error));
        }
      } catch {}
    });
    ws.addEventListener("close", () => {
      setConnected(false);
    });
    ws.addEventListener("error", (ev) => {
      setConnected(false);
      try {
        // Some environments may not provide detailed error events
        setError("WebSocket error: connection issue");
      } catch {}
    });
  }, [lobbyId, playerId, name, wsRef]);

  useEffect(() => {
    if (!lobbyId || !playerId) return;
    connectWs();
    const hb = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "heartbeat" }));
      }
    }, 10_000);
    return () => {
      clearInterval(hb);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
    };
  }, [lobbyId, playerId, connectWs, wsRef]);

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
      // Send role change over WebSocket
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setError("Not connected");
        return;
      }
      wsRef.current.send(
        JSON.stringify({ type: "role", selection: sel }),
      );
      setLastChangeAt(now);
      // Server will broadcast updated lobby; nothing to await here
      return;
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
          <div className="flex items-center gap-4 text-sm text-neutral-400">
            <div className="flex items-center gap-2">
              <span
                className={
                  "inline-block h-2 w-2 rounded-full " +
                  (connected ? "bg-green-500" : "bg-red-500")
                }
                aria-hidden
              />
              <span className={connected ? "text-green-400" : "text-red-400"}>
                {connected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <div>
              Signed in as <span className="text-neutral-200 font-medium">{name}</span>
            </div>
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
