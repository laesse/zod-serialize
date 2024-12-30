import { eventsSchema, CloseReasons } from "./shared";
import { encode, decode } from "zod-serialize";

const buildOutput = await Bun.build({
  target: "browser",
  entrypoints: ["./client.ts"],
});

const clientjs = new Response(await buildOutput.outputs[0].text(), {
  headers: { "Content-Type": "application/javascript" },
});

type Context = {
  id: number;
};

Bun.serve({
  port: 3000,
  static: {
    "/": new Response(await Bun.file("./index.html").text(), {
      headers: { "content-type": "text/html" },
    }),
    "/client.js": clientjs,
  },
  fetch() {
    return new Response("not found", { status: 404 });
  },
});

let nextId = 0;
const players = new Map<number, { x: number; y: number }>();
const playerMovements = new Map<number, { dx: number; dy: number }>();

enum WSChannels {
  PlayerUpdates = "playerUpdates",
}

const server = Bun.serve<Context>({
  port: 3001,

  fetch: (req, server) => {
    if (
      server.upgrade(req, {
        data: {
          id: nextId++,
        },
      })
    ) {
      return;
    }
    return new Response("upgrade failed", { status: 500 });
  },
  websocket: {
    open: (ws) => {
      ws.subscribe(WSChannels.PlayerUpdates);
      ws.binaryType = "arraybuffer";
      players.set(ws.data.id, { x: 100, y: 100 });
      playerMovements.set(ws.data.id, { dx: 0, dy: 0 });
      ws.send(
        encode(eventsSchema, {
          type: "welcome",
          yourId: ws.data.id,
          players,
        }),
      );
      ws.publish(
        WSChannels.PlayerUpdates,
        encode(eventsSchema, { type: "playerJoined", id: ws.data.id }),
      );
      ws.publish(
        WSChannels.PlayerUpdates,
        encode(eventsSchema, {
          type: "playerPos",
          id: ws.data.id,
          ...players.get(ws.data.id),
        }),
      );
    },
    close: (ws, code, reason) => {},
    // @ts-expect-error
    message: (ws, message: string | ArrayBuffer) => {
      if (typeof message === "string") {
        ws.close(CloseReasons.UnexpectedMessageType);
        return;
      }
      const event = decode(eventsSchema, message);
      if (event.type === "playerMove") {
        const player = players.get(ws.data.id);
        if (!player) return;
        playerMovements.set(ws.data.id, { dx: event.dx, dy: event.dy });
      } else if (event.type === "playerPos") {
        ws.close(CloseReasons.UnexpectedMessageType);
      } else if (event.type === "welcome") {
        ws.close(CloseReasons.UnexpectedMessageType);
      }
    },
  },
});

const updateInterval = setInterval(() => {
  for (const [id] of players) {
    const movement = playerMovements.get(id);
    if (!movement) continue;
    const player = players.get(id);
    if (!player) continue;
    if (movement.dx !== 0 || movement.dy !== 0) {
      player.x += movement.dx;
      player.y += movement.dy;
      const data = encode(eventsSchema, {
        type: "playerPos",
        id,
        x: player.x,
        y: player.y,
      });
      server.publish(WSChannels.PlayerUpdates, data);
    }
  }
}, 1000 / 60);
