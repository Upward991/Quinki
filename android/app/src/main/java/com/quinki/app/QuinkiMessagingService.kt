package com.quinki.app

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

// Riceve i messaggi FCM: in foreground li passa all'app web; in background il
// sistema mostra la notifica da solo (payload notification + data).
class QuinkiMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        try {
            val app = applicationContext as? MainActivity
        } catch (e: Exception) { }
        val data = message.data
        val sk = data["sessionKey"] ?: ""
        val title = message.notification?.title ?: data["title"] ?: ""
        val body = message.notification?.body ?: data["body"] ?: ""
        // Inoltra all'app web (istantaneo in app aperta).
        try {
            val web = MainActivity.instance?.webViewInstance()
            web?.post {
                try {
                    web.evaluateJavascript(
                        "window.__quinkiFcm && window.__quinkiFcm(" +
                            org.json.JSONObject(mapOf("sessionKey" to sk, "title" to title, "body" to body)).toString() +
                            ")", null
                    )
                } catch (e: Exception) { }
            }
        } catch (e: Exception) { }
    }

    override fun onNewToken(token: String) {
        try {
            MainActivity.instance?.onFcmToken(token)
        } catch (e: Exception) { }
    }
}
