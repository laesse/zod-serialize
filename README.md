# zod-serialize

Serialize js values into an ArrayBuffer with the help of a zod schema.

The package makes it easy to send binary payloads between a server and a client if they both have the same zod schema.
This can be useful for websocket applications where you want to send a lot of small objects over the wire and therefore don't want to have the JSON.stringify() overhead.


**examples:**
- [simple web game](examples/simple-web-game)
- todo
