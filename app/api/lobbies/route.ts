import { getRedis } from "@/lib/redis";
import { z } from "zod";
import type { Lobby, Player } from "@/lib/types";

export const runtime = "nodejs";

const CreateLobbySchema = z.object({
  player: z.object({ id: z.string(), name: z.string() }),
  baseTimeSeconds: z.number().int().positive().default(300),
  incrementSeconds: z.number().int().min(0).default(2),
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = CreateLobbySchema.parse(json);

    const lobbyId = crypto.randomUUID();
    const lobbyKey = `lobby:${lobbyId}`;

    const creator: Player = {
      id: parsed.player.id,
      name: parsed.player.name,
      isObserver: true,
    };

    const lobby: Lobby = {
      id: lobbyId,
      createdAt: Date.now(),
      players: [creator],
      readyPlayerIds: [],
      roles: {},
      lastRoleChangeAt: {},
      baseTimeSeconds: parsed.baseTimeSeconds,
      incrementSeconds: parsed.incrementSeconds,
    };

    const redis = await getRedis();
    await redis.set(lobbyKey, JSON.stringify(lobby));

    return new Response(JSON.stringify({ lobby }), {
      headers: { "content-type": "application/json" },
      status: 201,
    });
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ error: "Invalid request", detail: String(err) }),
      { headers: { "content-type": "application/json" }, status: 400 }
    );
  }
}
