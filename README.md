# zod-serialize

Serialize js values into an ArrayBuffer with the help of a zod schema.

The package makes it easy to send binary payloads between a server and a client if they both have the same zod schema.
This can be useful for websocket applications where you want to send a lot of small objects over the wire and therefore don't want to have the JSON.stringify() overhead.


**example:**
```ts
// --- server.ts ---
import { z } from 'zod';
import { encode, decode } from 'zod-serialize';

const playerPosSchema = z.object({
  type: z.literal('playerPos'),
  playerId: z.number(),
  x: z.number(),
  y: z.number(),
});

const serverUpdateSchema = z.discriminatedUnion("type", [
  playerPosSchema,
  // ...
]);


const playerMoveSchema = z.object({
  type: z.literal('playerMove'),
  direction: z.nativeEnum(),
});
const playerChatMessage= z.object({
  type: z.literal('playerChatMessage'),
  message: z.string(),
});
// ...
const playerMessageSchema = z.discriminatedUnion("type", [
  playerMoveSchema,
  playerChatMessage,
  // ...
]);


Bun.serve({
  // ...
   websocket: {
     // ...
     message: (ws, message) => {
        // ...
        const messageValue = decode(playerMessageSchema, message);
        if(messageValue.type === 'playerMove'){
          const newPlayerPos = updatePlayerPos(messageValue);
          const buffer = encode(serverUpdateSchema, newPlayerPos);
          ws.publishBinary("playerPos", buffer);
        }
        // ...
     }
     // ...
   }
})


// --- client.ts ---
import { playerPosSchema, playerMessageSchema } from './server.ts';
import { encode, decode } from 'zod-serialize';

const ws = new WebSocket('ws://localhost:3000');

ws.onmessage = (event) => {
  const messageValue = decode(playerMessageSchema, event.data);
  if(messageValue.type === 'playerPos'){
    const playerPos = decode(playerPosSchema, event.data);
    updatePlayerPos(playerPos);
  }
};

const onKeypress = (e) => {
  const direction = getDirectionFromKey(e.key);
  const buffer = encode(playerMessageSchema, { type: 'playerMove', direction });
  ws.send(buffer);
};
```

This project was created using `bun init` in bun v1.1.38. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
