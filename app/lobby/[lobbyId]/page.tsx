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
  const [copied, setCopied] = useState<boolean>(false);

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
    const protocol =
      typeof window !== "undefined" && window.location.protocol === "https:"
        ? "wss:"
        : "ws:";
    const url = `${protocol}//${window.location.host}/api/ws`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.addEventListener("open", () => {
      setConnected(true);
      setError("");
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
        } else if (msg.type === "start") {
          const gid = String(msg.gameId || "");
          console.log("[lobby] start message received", msg);
          if (gid) router.push(`/game/${gid}`);
        } else if (msg.type === "error") {
          console.error("[lobby] ws error", msg.error);
          setError(String(msg.error));
        }
      } catch {}
    });
    ws.addEventListener("close", () => {
      setConnected(false);
    });
    ws.addEventListener("error", (ev) => {
      console.log(ev);
      setConnected(false);
      try {
        // Some environments may not provide detailed error events
        setError("WebSocket error: connection issue");
      } catch {}
    });
  }, [wsRef, lobbyId, playerId, name, router]);

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

  /**
   * Returns the display name for a given player id occupying a role.
   */
  function occupantName(id?: string): string {
    if (!id || !lobby) return "Empty";
    const p = lobby.players.find((x) => x.id === id);
    return p ? p.name : "Unknown";
  }

  /**
   * Computes the current list of spectators.
   */
  function spectators(): Player[] {
    if (!lobby) return [];
    const roleIds = new Set<string>(
      Object.values(lobby.roles || ({} as LobbyRoles)).filter(
        (
          v,
        ): v is string => Boolean(v),
      ),
    );
    return lobby.players.filter((p) => !roleIds.has(p.id));
  }

  /**
   * Attempts to select a role (or clear selection with null).
   */
  const trySelect = async (
    sel: { team: Team; role: Role } | null,
  ): Promise<void> => {
    if (busy) return;
    const now = Date.now();
    if (now - lastChangeAt < 3000) return; // client guard
    setBusy(true);
    setError("");
    try {
      // Send role change over WebSocket (handle CONNECTING by deferring send)
      const ws = wsRef.current;
      if (!ws) {
        setError("Disconnected");
        return;
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "role", selection: sel }));
        setLastChangeAt(now);
        return;
      }
      if (ws.readyState === WebSocket.CONNECTING) {
        const handler = () => {
          try {
            ws.send(JSON.stringify({ type: "role", selection: sel }));
            setLastChangeAt(Date.now());
          } finally {
            ws.removeEventListener("open", handler);
          }
        };
        ws.addEventListener("open", handler);
        return;
      }
      setError("Disconnected");
      return;
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Cleanly leaves the lobby: notifies the server, closes the socket, navigates home.
   */
  const leaveLobby = useCallback((): void => {
    try {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "leave", lobbyId, playerId }));
        } catch {}
        try {
          ws.close();
        } catch {}
      }
    } finally {
      wsRef.current = null;
      router.push("/");
    }
  }, [router, wsRef, lobbyId, playerId]);

  /**
   * Copies the current lobby id to the clipboard with basic feedback.
   */
  const copyLobbyId = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(lobbyId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      setError(`Failed to copy lobby id, ${e}`);
    }
  }, [lobbyId]);

  // Derived host id (supports older lobbies without hostId)
  const hostId: string | undefined = useMemo<string | undefined>(
    () => lobby?.hostId || lobby?.players?.[0]?.id,
    [lobby],
  );

  const allRolesFilled: boolean = Boolean(
    lobby?.roles.whiteHand &&
      lobby?.roles.whiteBrain &&
      lobby?.roles.blackHand &&
      lobby?.roles.blackBrain,
  );
  const startGame = useCallback((): void => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log("[lobby] sending start request");
      ws.send(JSON.stringify({ type: "start" }));
    } else {
      console.warn("[lobby] cannot start, socket not open");
      setError("Disconnected");
    }
  }, [wsRef]);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200 px-4 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Lobby</h1>
            <button
              type="button"
              onClick={copyLobbyId}
              className="text-left text-sm text-neutral-400 hover:text-neutral-300 underline decoration-dotted break-all"
              aria-label="Copy lobby ID"
              title={copied ? "Copied!" : "Click to copy"}
            >
              {copied ? "Copied! " : "Lobby ID: "}
              {lobbyId}
            </button>
          </div>
          <div className="flex items-center gap-4 text-sm text-neutral-400">
            <div className="flex items-center gap-2">
              <span
                className={"inline-block h-2 w-2 rounded-full " +
                  (connected ? "bg-green-500" : "bg-red-500")}
                aria-hidden
              />
              <span className={connected ? "text-green-400" : "text-red-400"}>
                {connected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <div>
              Signed in as{" "}
              <span className="text-neutral-200 font-medium">{name}</span>
              {playerId === hostId && (
                <span className="ml-2 rounded border border-yellow-700 bg-yellow-900/30 px-2 py-0.5 text-xs text-yellow-300">
                  Host
                </span>
              )}
            </div>
            {playerId === hostId && (
              <button
                type="button"
                onClick={startGame}
                className="rounded-md border border-green-800 bg-green-950 px-3 py-1 text-green-200 hover:bg-green-900 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Start game"
                disabled={!allRolesFilled || !connected}
                title={!allRolesFilled
                  ? "Assign all roles to start"
                  : "Start game"}
              >
                Start Game
              </button>
            )}
            <button
              type="button"
              onClick={leaveLobby}
              className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-1 text-neutral-200 hover:bg-neutral-900"
              aria-label="Leave lobby and return home"
            >
              Home
            </button>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
            <h2 className="text-sm font-medium text-neutral-300">White</h2>
            <div className="mt-3 grid gap-2">
              <button
                className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-left hover:bg-neutral-900"
                onClick={() => trySelect({ team: "WHITE", role: "HAND" })}
                disabled={!connected || busy}
                aria-disabled={!connected || busy}
              >
                <div className="text-xs text-neutral-500">Hand</div>
                <div className="text-neutral-200">
                  {occupantName(lobby?.roles.whiteHand)}
                  {lobby?.roles.whiteHand &&
                    lobby?.roles.whiteHand === hostId && (
                    <span className="ml-2 text-xs text-yellow-400">(host)</span>
                  )}
                </div>
              </button>
              <button
                className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-left hover:bg-neutral-900"
                onClick={() => trySelect({ team: "WHITE", role: "BRAIN" })}
                disabled={!connected || busy}
                aria-disabled={!connected || busy}
              >
                <div className="text-xs text-neutral-500">Brain</div>
                <div className="text-neutral-200">
                  {occupantName(lobby?.roles.whiteBrain)}
                  {lobby?.roles.whiteBrain &&
                    lobby?.roles.whiteBrain === hostId && (
                    <span className="ml-2 text-xs text-yellow-400">(host)</span>
                  )}
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
                    <span>
                      {p.name}
                      {p.id === hostId && (
                        <span className="ml-2 text-xs text-yellow-400">
                          (host)
                        </span>
                      )}
                    </span>
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
                disabled={!connected || busy}
                aria-disabled={!connected || busy}
              >
                <div className="text-xs text-neutral-500">Hand</div>
                <div className="text-neutral-200">
                  {occupantName(lobby?.roles.blackHand)}
                  {lobby?.roles.blackHand &&
                    lobby?.roles.blackHand === hostId && (
                    <span className="ml-2 text-xs text-yellow-400">(host)</span>
                  )}
                </div>
              </button>
              <button
                className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-left hover:bg-neutral-900"
                onClick={() => trySelect({ team: "BLACK", role: "BRAIN" })}
                disabled={!connected || busy}
                aria-disabled={!connected || busy}
              >
                <div className="text-xs text-neutral-500">Brain</div>
                <div className="text-neutral-200">
                  {occupantName(lobby?.roles.blackBrain)}
                  {lobby?.roles.blackBrain &&
                    lobby?.roles.blackBrain === hostId && (
                    <span className="ml-2 text-xs text-yellow-400">(host)</span>
                  )}
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
