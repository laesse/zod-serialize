import { decode, encode } from "zod-serialize";
import { eventsSchema } from "./shared";

const game = document.getElementById("game") as HTMLCanvasElement;
const ctx = game.getContext("2d")!;

const ws = new WebSocket("ws://localhost:3001");
ws.binaryType = "arraybuffer";

const players = new Map<number, { x: number; y: number }>();
let myId = -1;
const movementState = {
  dx: 0,
  dy: 0,
};

ws.addEventListener("open", (message) => {
  console.log("open");
});
ws.addEventListener("close", (ev) => {
  console.log("close", ev);
});
ws.addEventListener("message", (message) => {
  if (typeof message.data === "string") {
    return;
  }
  const event = decode(eventsSchema, message.data);
  if (event.type === "welcome") {
    players.clear();
    for (const [id, { x, y }] of event.players) {
      players.set(id, { x, y });
    }
    myId = event.yourId;
  } else if (event.type === "playerPos") {
    const player = players.get(event.id);
    if (!player) return;
    player.x = event.x;
    player.y = event.y;
  } else if (event.type === "playerJoined") {
    players.set(event.id, { x: 0, y: 0 });
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowUp") {
    movementState.dy = -1;
  } else if (ev.key === "ArrowDown") {
    movementState.dy = 1;
  } else if (ev.key === "ArrowLeft") {
    movementState.dx = -1;
  } else if (ev.key === "ArrowRight") {
    movementState.dx = 1;
  }
  ws.send(
    encode(eventsSchema, {
      type: "playerMove",
      dx: movementState.dx,
      dy: movementState.dy,
    }),
  );
});
document.addEventListener("keyup", (ev) => {
  if (ev.key === "ArrowUp") {
    movementState.dy = 0;
  } else if (ev.key === "ArrowDown") {
    movementState.dy = 0;
  } else if (ev.key === "ArrowLeft") {
    movementState.dx = 0;
  } else if (ev.key === "ArrowRight") {
    movementState.dx = 0;
  }
  ws.send(
    encode(eventsSchema, {
      type: "playerMove",
      dx: movementState.dx,
      dy: movementState.dy,
    }),
  );
});

const colors = [
  "red",
  "green",
  "blue",
  "yellow",
  "purple",
  "orange",
  "pink",
  "brown",
  "grey",
  "black",
  "white",
];

function render() {
  ctx.clearRect(0, 0, game.width, game.height);
  for (const [id, { x, y }] of players) {
    ctx.fillStyle = colors[id % colors.length];
    if (myId === id) {
      ctx.fillRect(x, y, 13, 13);
    }
    ctx.fillRect(x, y, 10, 10);
  }
  requestAnimationFrame(render);
}
render();
