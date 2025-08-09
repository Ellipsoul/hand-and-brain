import { kv } from "@/lib/kv";
import { z } from "zod";
import type { Lobby, Player } from "@/lib/types";

export const runtime = "edge";

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
      baseTimeSeconds: parsed.baseTimeSeconds,
      incrementSeconds: parsed.incrementSeconds,
    };

    await kv.set(lobbyKey, lobby);

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
