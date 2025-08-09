import { getRedis } from "@/lib/redis";
import { z } from "zod";
import type { Lobby } from "@/lib/types";

export const runtime = "nodejs";

const ReadySchema = z.object({ playerId: z.string(), ready: z.boolean() });

export async function POST(
  req: Request,
  context: { params: Promise<{ lobbyId: string }> } | unknown,
) {
  const { lobbyId } = await (context as { params: Promise<{ lobbyId: string }> })
    .params;
  try {
    const json = await req.json();
    const parsed = ReadySchema.parse(json);

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

    const set = new Set(lobby.readyPlayerIds);
    if (parsed.ready) set.add(parsed.playerId);
    else set.delete(parsed.playerId);
    lobby.readyPlayerIds = Array.from(set);

    await redis.set(key, JSON.stringify(lobby));

    // Game creation and socket signal will be added later when socket is wired.

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
