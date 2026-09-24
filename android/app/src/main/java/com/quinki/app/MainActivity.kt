package com.quinki.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
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
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

// Quinki Android shell: loads the web app from the user's own tunnel link,
// pairs itself with the access token (typed or scanned from the QR code),
// keeps cookies persistent so the pairing survives restarts.
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var configPanel: View
    private lateinit var linkInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var statusText: TextView

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var retriedPair = false

    private val scanLauncher = registerForActivityResult(ScanContract()) { result ->
        val contents = result.contents
        if (!contents.isNullOrEmpty()) applyQr(contents)
    }

    private val fileChooserLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val cb = filePathCallback ?: return@registerForActivityResult
        filePathCallback = null
        val data = result.data
        val uris: Array<Uri>? = when {
            result.resultCode != RESULT_OK || data == null -> null
            data.clipData != null -> {
                val clip = data.clipData!!
                Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
            }
            data.data != null -> arrayOf(data.data!!)
            else -> null
        }
        cb.onReceiveValue(uris)
    }

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchScanner()
        else Toast.makeText(this, "Camera permission is needed to scan the QR code", Toast.LENGTH_LONG).show()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        web = findViewById(R.id.web)
        configPanel = findViewById(R.id.configPanel)
        linkInput = findViewById(R.id.linkInput)
        tokenInput = findViewById(R.id.tokenInput)
        statusText = findViewById(R.id.statusText)

        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.setAcceptThirdPartyCookies(web, true)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (url.startsWith("mailto:") || url.startsWith("tel:")) {
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
                    if (!retriedPair && link.isNotEmpty() && token.isNotEmpty()) {
                        retriedPair = true
                        view.loadUrl(pairUrl(link, token))
                    } else {
                        showConfig(link, token, "Pairing failed. Check the link and the token.")
                    }
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                CookieManager.getInstance().flush()
                retriedPair = false
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                val intent = params.createIntent()
                return try {
                    fileChooserLauncher.launch(intent)
                    true
                } catch (e: Exception) {
                    filePathCallback = null
                    false
                }
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                request.deny()
            }
        }

        findViewById<Button>(R.id.scanButton).setOnClickListener {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launchScanner()
            else cameraPermission.launch(Manifest.permission.CAMERA)
        }
        findViewById<Button>(R.id.connectButton).setOnClickListener { doConnect() }

        val prefs = getSharedPreferences("quinki", Context.MODE_PRIVATE)
        val link = prefs.getString("link", "") ?: ""
        val token = prefs.getString("token", "") ?: ""
        if (link.isNotEmpty() && token.isNotEmpty()) {
            configPanel.visibility = View.GONE
            web.visibility = View.VISIBLE
            web.loadUrl(link)
        } else {
            showConfig(link, token, "")
        }
    }

    private fun pairUrl(link: String, token: String): String = "$link/?token=" + Uri.encode(token)

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
        retriedPair = false
        web.loadUrl(pairUrl(link, token))
    }

    private fun applyQr(contents: String) {
        try {
            val uri = Uri.parse(contents.trim())
            val authority = uri.authority ?: ""
            val token = uri.getQueryParameter("token") ?: ""
            if (authority.isEmpty() || token.isEmpty()) throw IllegalArgumentException("missing parts")
            val link = "${uri.scheme}://$authority"
            linkInput.setText(link)
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
            .setPrompt("Scan the Quinki QR code")
            .setBeepEnabled(false)
            .setOrientationLocked(false)
        scanLauncher.launch(options)
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
}
