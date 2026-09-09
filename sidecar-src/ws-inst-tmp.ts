const WebSocket = require("ws");
const ws = new WebSocket("ws://127.0.0.1:9182");
ws.on("open", () => { ws.send(JSON.stringify({ id: "i", method: "ollamaInstall", params: {} })); });
ws.on("message", (d: any) => { const m = JSON.parse(d.toString()); if (m.id === "i") { console.log("start:", JSON.stringify(m.result ?? m.error)); process.exit(0); } });
