# Quinki FCM relay (Cloudflare Worker)

The sending key lives ONLY here as a Worker secret. The product (each user's Mac)
never contains it: the Mac posts {target, title, body, sessionKey} to this relay,
the relay sends via FCM. Abuse is impossible without knowing a device FCM token,
which never leaves phone + owner's Mac + relay; a per-IP rate limit is added as
a safety net.

## Deploy (free, 5 minutes, no CLI)

1. Create a free account at https://dash.cloudflare.com
2. Workers & Pages -> Create -> Worker -> name it `quinki-fcm` -> Deploy
3. Edit code -> replace everything with the content of `worker.js` -> Deploy
4. Worker Settings -> Variables and Secrets -> Add -> type Secret ->
   name `FCM_SA` -> value = the ENTIRE content of the Firebase service
   account JSON -> Save (then Deploy again if asked)
5. Copy the worker URL (https://quinki-fcm.<your-name>.workers.dev) and use it
   in the app: it is stored as ~/.quinki/fcm-relay.json as {"url": "..."}

## Config on each Mac

The sidecar sends through the relay when `~/.quinki/fcm-relay.json` exists
({"url": "https://...workers.dev"}). Otherwise it falls back to a local
service-account file (`~/.quinki/fcm-service-account.json`) which is only used
for development.
