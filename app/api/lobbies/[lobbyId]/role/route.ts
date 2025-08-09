import { getRedis } from "@/lib/redis";
import { z } from "zod";
import type { Lobby, LobbyRoles, Team, Role } from "@/lib/types";

export const runtime = "nodejs";

const SelectionSchema = z.object({
  playerId: z.string(),
  selection: z
    .object({ team: z.enum(["WHITE", "BLACK"] as const), role: z.enum(["HAND", "BRAIN"] as const) })
    .nullable(),
});

/**
 * Adjust a player's lobby role selection with conflict checks and a 3-second debounce.
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ lobbyId: string }> } | unknown,
) {
  const { lobbyId } = await (context as { params: Promise<{ lobbyId: string }> })
    .params;
  try {
    const body = await req.json();
    const parsed = SelectionSchema.parse(body);

    const key = `lobby:${lobbyId}`;
    const redis = await getRedis();
    const str = await redis.get(key);
    const lobby = str ? (JSON.parse(str) as Lobby) : null;
    if (!lobby) {
      return new Response(JSON.stringify({ error: "Lobby expired or not found" }), {
        headers: { "content-type": "application/json" },
        status: 404,
      });
    }
    if (Date.now() > lobby.expiresAt) {
      return new Response(JSON.stringify({ error: "Lobby expired" }), {
        headers: { "content-type": "application/json" },
        status: 410,
      });
    }

    // Ensure structures exist for older lobbies
    lobby.roles = lobby.roles || {} as LobbyRoles;
    lobby.lastRoleChangeAt = lobby.lastRoleChangeAt || {};

    // Cooldown: 3 seconds between role changes per player
    const now = Date.now();
    const last = lobby.lastRoleChangeAt[parsed.playerId] ?? 0;
    const cooldownMs = 3000;
    const delta = now - last;
    if (delta < cooldownMs) {
      return new Response(
        JSON.stringify({ error: "Cooldown", retryAfterMs: cooldownMs - delta }),
        { headers: { "content-type": "application/json" }, status: 429 }
      );
    }

    // Remove player from any current role
    const roles = lobby.roles;
    (Object.keys(roles) as (keyof LobbyRoles)[]).forEach((k) => {
      if (roles[k] === parsed.playerId) roles[k] = undefined;
    });

    // If selection is null -> spectator; persist and return
    if (!parsed.selection) {
      lobby.lastRoleChangeAt[parsed.playerId] = now;
      await redis.set(key, JSON.stringify(lobby));
      return new Response(
        JSON.stringify({ lobby }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    }

    // Map selection to the corresponding key
    const roleKey = ((): keyof LobbyRoles => {
      const t: Team = parsed.selection!.team;
      const r: Role = parsed.selection!.role;
      if (t === "WHITE" && r === "HAND") return "whiteHand";
      if (t === "WHITE" && r === "BRAIN") return "whiteBrain";
      if (t === "BLACK" && r === "HAND") return "blackHand";
      return "blackBrain";
    })();

    // Check occupancy
    const occupant = roles[roleKey];
    if (occupant && occupant !== parsed.playerId) {
      return new Response(
        JSON.stringify({ error: "Role already occupied" }),
        { headers: { "content-type": "application/json" }, status: 409 }
      );
    }

    // Assign role
    roles[roleKey] = parsed.playerId;
    lobby.lastRoleChangeAt[parsed.playerId] = now;
    lobby.lastSeen = lobby.lastSeen || {};
    lobby.lastSeen[parsed.playerId] = now;
    await redis.set(key, JSON.stringify(lobby));

    return new Response(JSON.stringify({ lobby }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ error: "Invalid request", detail: String(err) }),
      { headers: { "content-type": "application/json" }, status: 400 }
    );
  }
}
