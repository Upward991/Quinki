package com.quinki.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

// Quinki Push: tiene UNA connessione col Mac dell'utente (via tunnel) e mostra
// le notifiche native con le azioni [Mute] [Mark read] [Reply]. Il tap apre la
// chat. Tutto in casa: mai Google, mai terze parti.
class PushService : Service() {

    companion object {
        const val EXTRA_SK = "push_session_key"
        private const val ACTION_MUTE = "com.quinki.app.PUSH_MUTE"
        private const val ACTION_READ = "com.quinki.app.PUSH_READ"
        private const val ACTION_REPLY = "com.quinki.app.PUSH_REPLY"
        private const val CH_SERVICE = "quinki_service"
        private const val CH_NOTIF = "quinki_notifications"
        private const val SERVICE_NOTIF_ID = 1
        private const val REPLY_KEY = "reply_text"

        fun start(context: Context) {
            try {
                val i = Intent(context, PushService::class.java)
                androidx.core.content.ContextCompat.startForegroundService(context, i)
            } catch (e: Exception) { }
        }
    }

    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .pingInterval(30, TimeUnit.SECONDS)
        .build()
    private var ws: WebSocket? = null
    private var retryMs = 2000L

    private val appName: String
        get() = if (packageName.endsWith(".expert")) "App Expert" else "Quinki"

    private fun createChannels() {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(NotificationChannel(CH_NOTIF, "Notifications", NotificationManager.IMPORTANCE_HIGH))
            val svc = NotificationChannel(CH_SERVICE, "Connection", NotificationManager.IMPORTANCE_MIN)
            svc.description = "Keeps $appName notifications instant. You can hide this."
            nm.createNotificationChannel(svc)
        } catch (e: Exception) { }
    }

    private fun buildServiceNotification() = NotificationCompat.Builder(this, CH_SERVICE)
        .setSmallIcon(R.drawable.ic_stat_quinki)
        .setContentTitle("$appName connected")
        .setContentText("Notifications arrive instantly")
        .setPriority(NotificationCompat.PRIORITY_MIN)
        .setOngoing(true)
        .build()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannels()
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(SERVICE_NOTIF_ID, buildServiceNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(SERVICE_NOTIF_ID, buildServiceNotification())
            }
        } catch (e: Exception) { }
        connect()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            when (intent?.action) {
                ACTION_MUTE -> {
                    val sk = intent.getStringExtra(EXTRA_SK) ?: ""
                    if (sk.isNotEmpty()) { rpc("setNotifyMode", JSONObject().put("sessionKey", sk).put("mode", "none")); cancelNotif(sk) }
                }
                ACTION_READ -> {
                    val sk = intent.getStringExtra(EXTRA_SK) ?: ""
                    if (sk.isNotEmpty()) { rpc("setReadState", JSONObject().put("sessionKey", sk).put("patch", JSONObject().put("lastReadTs", System.currentTimeMillis()))); cancelNotif(sk) }
                }
                ACTION_REPLY -> {
                    val sk = intent.getStringExtra(EXTRA_SK) ?: ""
                    val text = try { RemoteInput.getResultsFromIntent(intent)?.getCharSequence(REPLY_KEY)?.toString() ?: "" } catch (e: Exception) { "" }
                    if (sk.isNotEmpty() && text.isNotEmpty()) { rpc("sendMessage", JSONObject().put("sessionKey", sk).put("text", text)); cancelNotif(sk) }
                }
            }
        } catch (e: Exception) { }
        return START_STICKY
    }

    private fun cancelNotif(sk: String) {
        try { NotificationManagerCompat.from(this).cancel(sk.hashCode()) } catch (e: Exception) { }
    }

    private fun rpc(method: String, params: JSONObject) {
        try {
            val id = "svc-" + System.currentTimeMillis()
            ws?.send(JSONObject().put("jsonrpc", "2.0").put("id", id).put("method", method).put("params", params).toString())
        } catch (e: Exception) { }
    }

    private fun connect() {
        try {
            val prefs = getSharedPreferences("quinki", Context.MODE_PRIVATE)
            val link = prefs.getString("link", "") ?: ""
            if (link.isEmpty()) { scheduleReconnect(15000); return }
            val wsUrl = link.replace("https://", "wss://").replace("http://", "ws://")
            val cookie = try { android.webkit.CookieManager.getInstance().getCookie(link) ?: "" } catch (e: Exception) { "" }
            val req = Request.Builder().url(wsUrl).apply {
                if (cookie.isNotEmpty()) addHeader("Cookie", cookie)
            }.build()
            ws = http.newWebSocket(req, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    retryMs = 2000L
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    try {
                        val m = JSONObject(text)
                        if (m.optString("method") != "push_notify") return
                        val p = m.optJSONObject("params") ?: return
                        showNotification(p.optString("title"), p.optString("body"), p.optString("sessionKey"))
                    } catch (e: Exception) { }
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    ws = null
                    scheduleReconnect(retryMs)
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    ws = null
                    scheduleReconnect(retryMs)
                }
            })
        } catch (e: Exception) {
            scheduleReconnect(retryMs)
        }
    }

    private fun scheduleReconnect(delay: Long) {
        retryMs = (retryMs * 2).coerceAtMost(60000L)
        try { Handler(Looper.getMainLooper()).postDelayed({ connect() }, delay) } catch (e: Exception) { }
    }

    private fun showNotification(titleIn: String, body: String, sk: String) {
        try {
            val title = titleIn.ifEmpty { appName }
            val id = sk.ifEmpty { title }.hashCode()

            val openIntent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra("sessionKey", sk)
            }
            val openPi = PendingIntent.getActivity(this, id, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

            val mutePi = PendingIntent.getService(this, id + 1,
                Intent(this, PushService::class.java).setAction(ACTION_MUTE).putExtra(EXTRA_SK, sk),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val readPi = PendingIntent.getService(this, id + 2,
                Intent(this, PushService::class.java).setAction(ACTION_READ).putExtra(EXTRA_SK, sk),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val replyPi = PendingIntent.getService(this, id + 3,
                Intent(this, PushService::class.java).setAction(ACTION_REPLY).putExtra(EXTRA_SK, sk),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
            val replyAction = NotificationCompat.Action.Builder(0, "Reply", replyPi)
                .addRemoteInput(RemoteInput.Builder(REPLY_KEY).setLabel("Reply").build())
                .build()

            val n = NotificationCompat.Builder(this, CH_NOTIF)
                .setSmallIcon(R.drawable.ic_stat_quinki)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(openPi)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setOnlyAlertOnce(false)
                .addAction(0, "Mute", mutePi)
                .addAction(0, "Mark read", readPi)
                .addAction(replyAction)
                .build()

            val nm = NotificationManagerCompat.from(this)
            if (nm.areNotificationsEnabled()) nm.notify(id, n)
        } catch (e: Exception) { }
    }
}
