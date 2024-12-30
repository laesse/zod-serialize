import { z } from "zod";

export const playerMoveSchmea = z.object({
  type: z.literal("playerMove"),
  dx: z.number(),
  dy: z.number(),
});
export const playerPosSchmea = z.object({
  type: z.literal("playerPos"),
  id: z.number(),
  x: z.number(),
  y: z.number(),
});
export const welcomeSchmea = z.object({
  type: z.literal("welcome"),
  yourId: z.number(),
  players: z.map(z.number(), z.object({ x: z.number(), y: z.number() })),
});
export const playerJoindedSchmea = z.object({
  type: z.literal("playerJoined"),
  id: z.number(),
});

export const eventsSchema = z.discriminatedUnion("type", [
  playerMoveSchmea,
  playerPosSchmea,
  welcomeSchmea,
  playerJoindedSchmea,
]);

export enum CloseReasons {
  UnexpectedMessageType = 4000,
}
