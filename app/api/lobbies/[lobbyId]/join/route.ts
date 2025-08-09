import { getRedis } from "@/lib/redis";
import { z } from "zod";
import type { Lobby, Player } from "@/lib/types";

export const runtime = "nodejs";

const JoinSchema = z.object({ player: z.object({ id: z.string(), name: z.string() }) });

export async function POST(req: Request, context: unknown) {
  const { params } = (context || {}) as { params: { lobbyId: string } };
  try {
    const json = await req.json();
    const parsed = JoinSchema.parse(json);

    const key = `lobby:${params.lobbyId}`;
    const redis = await getRedis();
    const str = await redis.get(key);
    const lobby = str ? (JSON.parse(str) as Lobby) : null;
    if (!lobby) {
      return new Response(JSON.stringify({ error: "Lobby not found" }), {
        headers: { "content-type": "application/json" },
        status: 404,
      });
    }

    const exists = lobby.players.some((p) => p.id === parsed.player.id);
    if (!exists) {
      const newPlayer: Player = { ...parsed.player, isObserver: true };
      lobby.players.push(newPlayer);
      await redis.set(key, JSON.stringify(lobby));
    }

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
