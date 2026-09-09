const WebSocket = require("ws");
const ws = new WebSocket("ws://127.0.0.1:9182");
const t = setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 30000);
ws.on("open", () => {
  ws.send(JSON.stringify({ id: "u1", method: "getProviderUsage", params: { providerName: "OpenRouter" } }));
});
ws.on("message", (d: any) => {
  const msg = JSON.parse(d.toString());
  if (msg.id === "u1") {
    console.log(JSON.stringify(msg.result, null, 1));
    clearTimeout(t); process.exit(0);
  }
});
