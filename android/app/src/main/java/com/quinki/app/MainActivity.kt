package com.quinki.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.view.View
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONArray
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

// Quinki for Android: loads the Quinki web app from the user's own tunnel,
// pairs with the access token (typed or scanned), asks for the permissions the
// app needs, and updates itself from the GitHub release of this project.
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var configPanel: View
    private lateinit var linkInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var statusText: TextView

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var lastCameraUri: Uri? = null
    private var askedPermissions = false
    private var updateChecked = false
    private var downloadId = -1L

    private val scanLauncher = registerForActivityResult(ScanContract()) { result ->
        val contents = result.contents
        if (!contents.isNullOrEmpty()) applyQr(contents)
    }

    private val fileChooserLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val cb = filePathCallback ?: return@registerForActivityResult
        filePathCallback = null
        val data = result.data
        val uris: Array<Uri>? = when {
            result.resultCode != RESULT_OK -> null
            data == null -> lastCameraUri?.let { arrayOf(it) }
            data.clipData != null -> {
                val clip = data.clipData!!
                Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
            }
            data.data != null -> arrayOf(data.data!!)
            else -> lastCameraUri?.let { arrayOf(it) }
        }
        lastCameraUri = null
        cb.onReceiveValue(uris)
    }

    private val cameraCaptureLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val cb = filePathCallback ?: return@registerForActivityResult
        filePathCallback = null
        if (result.resultCode == RESULT_OK && lastCameraUri != null) cb.onReceiveValue(arrayOf(lastCameraUri!!))
        else cb.onReceiveValue(null)
        lastCameraUri = null
    }

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchScanner()
        else Toast.makeText(this, "Camera permission is needed to scan the QR code", Toast.LENGTH_LONG).show()
    }

    private val permissionsLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }

    private val downloadReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
            if (id != downloadId) return
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val uri = dm.getUriForDownloadedFile(id)
            if (uri != null) {
                val i = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                try { startActivity(i) } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "Could not open the installer", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        val root = findViewById<View>(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            insets
        }

        web = findViewById(R.id.web)
        configPanel = findViewById(R.id.configPanel)
        linkInput = findViewById(R.id.linkInput)
        tokenInput = findViewById(R.id.tokenInput)
        statusText = findViewById(R.id.statusText)

        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.setAcceptThirdPartyCookies(web, true)

        web.setBackgroundColor(0xFF08080B.toInt())
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            // Combo GIUSTA per una web app responsive:
            // - useWideViewPort=true: Android RISPETTA il viewport meta (width=device-width).
            //   Con false la pagina viene disegnata a 980px -> layout desktop sul telefono
            //   (menu tagliati, niente UI mobile). Era il bug.
            // - loadWithOverviewMode=false: mai zoom-out per far entrare i contenuti.
            useWideViewPort = true
            loadWithOverviewMode = false
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            // Marcatore con la VERSIONE esatta dell'APK: sul Mac la lista
            // dispositivi mostra quale build sta girando sul telefono.
            val appMarker = (if (packageName.endsWith(".expert")) "QuinkiAppExpert" else "QuinkiApp") + "/" + BuildConfig.VERSION_NAME
            userAgentString = userAgentString + " " + appMarker
        }

        // Il sistema puo' uccidere il renderer del WebView quando apri altre app
        // pesanti (es. il browser): teniamolo prioritario e ripristiniamo la
        // pagina da soli se succede.
        try { web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false) } catch (e: Exception) { }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (!url.startsWith("http://") && !url.startsWith("https://")) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (e: Exception) { }
                    return true
                }
                // Link verso un host diverso dall'app: apri nel browser di sistema
                // (download di APK compresi). L'app resta sul suo link.
                val selfHost = try {
                    Uri.parse(getSharedPreferences("quinki", Context.MODE_PRIVATE).getString("link", "") ?: "").host
                } catch (e: Exception) { null }
                val thisHost = request.url.host
                if (thisHost != null && selfHost != null && thisHost != selfHost) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (e: Exception) { }
                    return true
                }
                return false
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                if (errorResponse.statusCode == 401 && request.isForMainFrame) {
                    val prefs = getSharedPreferences("quinki", Context.MODE_PRIVATE)
                    val link = prefs.getString("link", "") ?: ""
                    val token = prefs.getString("token", "") ?: ""
                    showConfig(link, token, "Pairing expired or revoked. Tap Connect to pair again.")
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                CookieManager.getInstance().flush()
                ensurePermissions()
            }

            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                // Renderer morto (pressione di memoria): ricarica subito la stessa
                // pagina invece di lasciare l'app bloccata/riavviata.
                try {
                    val link = getSharedPreferences("quinki", Context.MODE_PRIVATE).getString("link", "") ?: ""
                    if (link.isNotEmpty() && web.visibility == View.VISIBLE) {
                        view.loadUrl(link, mapOf("X-Quinki-App" to "1"))
                    }
                } catch (e: Exception) { }
                return true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                if (params.isCaptureEnabled) return launchCameraCapture()
                return launchFileChooser(params)
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                val grants = mutableListOf<String>()
                for (res in request.resources) {
                    when (res) {
                        PermissionRequest.RESOURCE_AUDIO_CAPTURE ->
                            if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) grants.add(res)
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE ->
                            if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) grants.add(res)
                    }
                }
                if (grants.isNotEmpty()) request.grant(grants.toTypedArray()) else request.deny()
            }
        }

        web.setDownloadListener { url, _, _, _, _ ->
            // Rete di sicurezza per i download diretti (es. .apk): browser di sistema.
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (e: Exception) { }
        }

        findViewById<Button>(R.id.scanButton).setOnClickListener {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launchScanner()
            else cameraPermission.launch(Manifest.permission.CAMERA)
        }
        findViewById<Button>(R.id.connectButton).setOnClickListener { doConnect() }

        try {
            ContextCompat.registerReceiver(this, downloadReceiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_NOT_EXPORTED)
        } catch (e: Exception) { }

        val prefs = getSharedPreferences("quinki", Context.MODE_PRIVATE)
        // Prima apertura dopo un aggiornamento: svuota la cache HTTP cosi' la web
        // app arriva sempre fresca (i cookie NON si toccano).
        if (prefs.getInt("lastVersionCode", 0) != BuildConfig.VERSION_CODE) {
            prefs.edit().putInt("lastVersionCode", BuildConfig.VERSION_CODE).apply()
            try { web.clearCache(true) } catch (e: Exception) { }
        }
        val link = prefs.getString("link", "") ?: ""
        val token = prefs.getString("token", "") ?: ""
        if (link.isNotEmpty() && token.isNotEmpty()) {
            configPanel.visibility = View.GONE
            web.visibility = View.VISIBLE
            loadUrlWithAppHeader(link)
        } else {
            showConfig(link, token, "")
        }

        checkForUpdate()
    }

    private fun pairUrl(link: String, token: String): String = "$link/?token=" + Uri.encode(token)

    private fun loadUrlWithAppHeader(url: String) {
        web.loadUrl(url, mapOf("X-Quinki-App" to "1"))
    }

    private fun doConnect() {
        val link = linkInput.text.toString().trim().trimEnd('/')
        val token = tokenInput.text.toString().trim()
        if (!link.startsWith("http://") && !link.startsWith("https://")) {
            statusText.text = "The link must start with http:// or https://"
            return
        }
        if (token.isEmpty()) {
            statusText.text = "Enter the access token, or scan the QR code"
            return
        }
        getSharedPreferences("quinki", Context.MODE_PRIVATE).edit()
            .putString("link", link).putString("token", token).apply()
        statusText.text = ""
        configPanel.visibility = View.GONE
        web.visibility = View.VISIBLE
        loadUrlWithAppHeader(pairUrl(link, token))
    }

    private fun applyQr(contents: String) {
        try {
            val uri = Uri.parse(contents.trim())
            val authority = uri.authority ?: ""
            val token = uri.getQueryParameter("token") ?: ""
            if (authority.isEmpty() || token.isEmpty()) throw IllegalArgumentException("missing parts")
            linkInput.setText("${uri.scheme}://$authority")
            tokenInput.setText(token)
            doConnect()
        } catch (e: Exception) {
            statusText.text = "QR code not recognized. It should contain the Quinki pairing link."
        }
    }

    private fun showConfig(link: String, token: String, message: String) {
        configPanel.visibility = View.VISIBLE
        web.visibility = View.GONE
        if (linkInput.text.isNullOrEmpty()) linkInput.setText(link)
        if (tokenInput.text.isNullOrEmpty()) tokenInput.setText(token)
        statusText.text = message
    }

    private fun launchScanner() {
        val options = ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("Scan the QR code shown in Quinki on your Mac")
            .setBeepEnabled(false)
            .setOrientationLocked(false)
        scanLauncher.launch(options)
    }

    // Tutte le autorizzazioni che servono, chieste una volta sola al primo uso:
    // fotocamera (QR e foto), microfono (dettatura) e notifiche.
    private fun ensurePermissions() {
        if (askedPermissions) return
        askedPermissions = true
        val need = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.CAMERA)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, "android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            need.add("android.permission.POST_NOTIFICATIONS")
        }
        if (need.isNotEmpty()) permissionsLauncher.launch(need.toTypedArray())
    }

    private fun newPhotoUri(): Uri {
        val dir = File(cacheDir, "photos").apply { mkdirs() }
        val f = File.createTempFile("photo_", ".jpg", dir)
        return FileProvider.getUriForFile(this, "$packageName.fileprovider", f)
    }

    private fun launchCameraCapture(): Boolean {
        return try {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                filePathCallback = null
                ensurePermissions()
                return false
            }
            val uri = newPhotoUri()
            lastCameraUri = uri
            val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, uri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            cameraCaptureLauncher.launch(intent)
            true
        } catch (e: Exception) {
            filePathCallback = null
            false
        }
    }

    private fun launchFileChooser(params: WebChromeClient.FileChooserParams): Boolean {
        return try {
            val content = params.createIntent()
            try {
                val uri = newPhotoUri()
                lastCameraUri = uri
                val cam = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                    putExtra(MediaStore.EXTRA_OUTPUT, uri)
                    addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                val chooser = Intent(Intent.ACTION_CHOOSER).apply {
                    putExtra(Intent.EXTRA_INTENT, content)
                    putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(cam))
                }
                fileChooserLauncher.launch(chooser)
            } catch (e: Exception) {
                fileChooserLauncher.launch(content)
            }
            true
        } catch (e: Exception) {
            filePathCallback = null
            false
        }
    }

    // === Aggiornamento automatico dalla release GitHub di questo progetto ===
    private fun checkForUpdate() {
        if (updateChecked) return
        updateChecked = true
        Thread {
            try {
                val conn = URL("https://api.github.com/repos/Upward991/Quinki/releases?per_page=15").openConnection() as HttpURLConnection
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                conn.setRequestProperty("Accept", "application/vnd.github+json")
                conn.setRequestProperty("User-Agent", "QuinkiApp")
                val body = conn.inputStream.bufferedReader().readText()
                val arr = JSONArray(body)
                val prefix = if (packageName.endsWith(".expert")) "Quinki_Expert_Android_" else "Quinki_Android_"
                var tag: String? = null
                var url: String? = null
                for (i in 0 until arr.length()) {
                    val rel = arr.getJSONObject(i)
                    if (rel.optBoolean("draft")) continue
                    val assets = rel.optJSONArray("assets") ?: continue
                    for (j in 0 until assets.length()) {
                        val a = assets.getJSONObject(j)
                        val name = a.optString("name")
                        if (name.startsWith(prefix) && name.endsWith(".apk")) {
                            tag = rel.optString("tag_name")
                            url = a.optString("browser_download_url")
                            break
                        }
                    }
                    if (tag != null) break
                }
                // Solo se la release e' PIU' NUOVA davvero (confronto numerico
                // di beta.N): mai prompt all'indietro per build di lavoro.
                fun betaNum(v: String): Int? = Regex("beta\\.(\\d+)").find(v)?.groupValues?.get(1)?.toIntOrNull()
                if (tag != null && url != null && tag != "v" + BuildConfig.VERSION_NAME) {
                    val cur = betaNum(BuildConfig.VERSION_NAME)
                    val rem = betaNum(tag)
                    val newer = if (cur != null && rem != null) rem > cur else true
                    if (newer) runOnUiThread { promptUpdate(tag, url) }
                }
            } catch (e: Exception) { }
        }.start()
    }

    private fun promptUpdate(tag: String, url: String) {
        try {
            AlertDialog.Builder(this)
                .setTitle("Update available")
                .setMessage("Version $tag is available. You have ${BuildConfig.VERSION_NAME}. Install it now?")
                .setPositiveButton("Install") { _, _ -> startUpdateDownload(tag, url) }
                .setNegativeButton("Later", null)
                .show()
        } catch (e: Exception) { }
    }

    private fun startUpdateDownload(tag: String, url: String) {
        try {
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setTitle("Quinki update $tag")
                setMimeType("application/vnd.android.package-archive")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                setDestinationInExternalFilesDir(this@MainActivity, null, "quinki-update.apk")
            }
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            downloadId = dm.enqueue(request)
            Toast.makeText(this, "Downloading the update…", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Update failed to start", Toast.LENGTH_LONG).show()
        }
    }

    override fun onBackPressed() {
        if (web.visibility == View.VISIBLE && web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
        web.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onDestroy() {
        super.onDestroy()
        try { unregisterReceiver(downloadReceiver) } catch (e: Exception) { }
    }
}
