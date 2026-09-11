use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem, Submenu, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
    Manager, WindowEvent, Emitter,
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;

static SHOULD_EXIT: AtomicBool = AtomicBool::new(false);
// === FIX quit macOS: ExitRequested NON scatta su macOS (bug Tauri #13778/#9198) —
// Cmd+Q e dock passano da applicationShouldTerminate, NON da RunEvent::ExitRequested.
// Intercettiamo applicationShouldTerminate con un delegate NSApplication (crate objc).
#[cfg(target_os = "macos")]
mod terminate_delegate {
    use objc::declare::ClassDecl;
    use objc::runtime::{Class, Object, Sel};
    use objc::{class, msg_send, sel, sel_impl};
    use std::sync::atomic::Ordering;
    use std::sync::OnceLock;
    use tauri::{Emitter, Manager};

    use super::SHOULD_EXIT;

    static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
    // Il delegate DEVE sopravvivere per tutta la vita dell'app
    struct DelegatePtr(*mut Object);
    // SAFETY: il puntatore è usato solo sul main thread (NSApplicationDelegate è main-only)
    unsafe impl Send for DelegatePtr {}
    unsafe impl Sync for DelegatePtr {}
    static mut DELEGATE: DelegatePtr = DelegatePtr(std::ptr::null_mut());

    extern "C" fn application_should_terminate(_this: &mut Object, _cmd: Sel, _app: *mut Object) -> i32 {
        // NSApplicationTerminateReply: NSTerminateNow=1, NSTerminateCancel=0
        if SHOULD_EXIT.load(Ordering::SeqCst) {
            1
        } else {
            if let Some(app) = APP_HANDLE.get() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let _ = app.emit("quit_requested", ());
            }
            0
        }
    }

    // Click sull'icona del dock quando la finestra è nascosta (close-to-tray):
    // riapri la finestra. Questo funziona a livello NSApplication, indipendente
    // dall'evento RunEvent::Reopen di Tauri.
    extern "C" fn application_should_handle_reopen(_this: &mut Object, _cmd: Sel, _app: *mut Object, _has_visible: i32) -> i32 {
        if let Some(app) = APP_HANDLE.get() {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            let _ = app.emit("app_reopened", ());
        }
        1 // handled: YES
    }

    pub fn install(app: tauri::AppHandle) {
        let _ = APP_HANDLE.set(app);
        unsafe {
            let superclass = Class::get("NSObject").expect("NSObject");
            let mut decl = ClassDecl::new("QuinkiTerminateDelegate", superclass).expect("ClassDecl");
            decl.add_method(
                sel!(applicationShouldTerminate:),
                application_should_terminate as extern "C" fn(&mut Object, Sel, *mut Object) -> i32,
            );
            decl.add_method(
                sel!(applicationShouldHandleReopen:hasVisibleWindows:),
                application_should_handle_reopen as extern "C" fn(&mut Object, Sel, *mut Object, i32) -> i32,
            );
            let cls = decl.register();
            let delegate: *mut Object = msg_send![cls, new];
            let nsapp: *mut Object = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![nsapp, setDelegate: delegate];
            DELEGATE = DelegatePtr(delegate); // static mut: dentro unsafe
        }
    }
}


// Detect if running as App Expert (separate app)
fn is_expert_mode() -> bool {
    // Check if the executable path contains "App Expert"
    if let Ok(exe) = std::env::current_exe() {
        if exe.to_string_lossy().contains("App Expert") {
            return true;
        }
    }
    // Also check for --expert arg
    if std::env::args().any(|a| a == "--expert") {
        return true;
    }
    false
}

// MD5 di un file (usa il tool di sistema macOS `md5 -q`)
fn file_md5(path: &str) -> Option<String> {
    let out = std::process::Command::new("md5").arg("-q").arg(path).output().ok()?;
    if !out.status.success() { return None; }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

// Impronta di un'app bundle: (MD5 binario, MD5 sidecar)
fn app_build_fingerprint(app_root: &str) -> Option<(String, String)> {
    let bin = format!("{}/Contents/MacOS/quinki", app_root);
    let sidecar = format!("{}/Contents/Resources/resources/sidecar/quinki-sidecar-ws", app_root);
    let b = file_md5(&bin)?;
    let s = file_md5(&sidecar)?;
    Some((b, s))
}

// Registra l'MD5 del build che l'Expert STA ESEGUENDO (salvato all'avvio).
// È la base del confronto: il badge appare solo se il build della main differisce
// da questo (cioè il cambiamento non è stato ancora applicato a se stesso).
fn record_running_build() {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let path = format!("{}/.quinki/.expert-running-build.json", home);
    if let Some((b, s)) = app_build_fingerprint("/Applications/App Expert.app") {
        let _ = std::fs::write(&path, format!("{{\"binary\":\"{}\",\"sidecar\":\"{}\"}}", b, s));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tauri::command]
fn __drag_window(window: tauri::WebviewWindow) {
  let _ = window.start_dragging();
}

#[tauri::command]
fn __toggle_maximize(window: tauri::WebviewWindow) {
  let _ = if window.is_maximized().unwrap_or(false) { window.unmaximize().ok() } else { window.maximize().ok() };
}

#[tauri::command]
fn set_window_bg_color(_window: tauri::WebviewWindow, _color: String) {}

#[tauri::command]
fn export_chat_file(window: tauri::WebviewWindow, content: String, filename: String, extension: String) -> Result<String, String> {
    use rfd::FileDialog;
    let filter_name = if extension == "md" { "Markdown" } else { "HTML" };
    let dialog = FileDialog::new()
        .set_file_name(&filename)
        .add_filter(filter_name, &[&extension]);
    let dialog = dialog.set_parent(&window);
    let file = dialog.save_file();
    match file {
        Some(path) => {
            std::fs::write(&path, &content).map_err(|e| e.to_string())?;
            Ok(path.to_string_lossy().to_string())
        }
        None => Err("cancelled".to_string()),
    }
}

#[tauri::command]
fn pick_directory(window: tauri::WebviewWindow) -> Result<String, String> {
    use rfd::FileDialog;
    let dialog = FileDialog::new()
        .set_title("Select working directory");
    let dialog = dialog.set_parent(&window);
    match dialog.pick_folder() {
        Some(path) => Ok(path.to_string_lossy().to_string()),
        None => Err("cancelled".to_string()),
    }
}

#[tauri::command]
fn pick_profile_image(window: tauri::WebviewWindow) -> Result<String, String> {
    use rfd::FileDialog;
    let dialog = FileDialog::new().set_title("Select profile picture");
    let dialog = dialog.set_parent(&window);
    match dialog.pick_file() {
        Some(path) => {
            let path_str = path.to_string_lossy().to_string();
            match std::fs::read(&path) {
                Ok(bytes) => {
                    let b64 = base64_encode(&bytes);
                    // estensione per il mime
                    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase().to_string()).unwrap_or_default();
                    let mime = match ext.as_str() {
                        "png" => "image/png",
                        "jpg" | "jpeg" => "image/jpeg",
                        "gif" => "image/gif",
                        "webp" => "image/webp",
                        _ => "image/png",
                    };
                    Ok(format!("data:{};base64,{}", mime, b64))
                }
                Err(e) => Err(format!("read error: {}", e)),
            }
        }
        None => Err("cancelled".to_string()),
    }
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[(n >> 18) as usize & 63] as char);
        out.push(CHARS[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 { out.push(CHARS[(n >> 6) as usize & 63] as char) } else { out.push('=') }
        if chunk.len() > 2 { out.push(CHARS[n as usize & 63] as char) } else { out.push('=') }
    }
    out
}

#[tauri::command]
fn pick_files(window: tauri::WebviewWindow) -> Result<Vec<String>, String> {
    use rfd::FileDialog;
    let dialog = FileDialog::new().set_title("Select files to attach");
    let dialog = dialog.set_parent(&window);
    match dialog.pick_files() {
        Some(paths) => Ok(paths.iter().map(|p| p.to_string_lossy().to_string()).collect()),
        None => Err("cancelled".to_string()),
    }
}

#[tauri::command]
fn copy_to_attachments(src_path: String, session_key: String) -> Result<serde_json::Value, String> {
    use std::fs;
    use std::path::Path;

    let home = std::env::var("HOME").unwrap_or_default();
    let attachments_dir = format!("{}/.quinki/attachments/{}", home, session_key);

    // Create directory if it doesn't exist
    fs::create_dir_all(&attachments_dir).map_err(|e| e.to_string())?;

    let src = Path::new(&src_path);
    let original_name = src.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // Generate unique name: <uuid>-<original-name>
    let uuid = {
        use std::time::{SystemTime, UNIX_EPOCH};
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        format!("{:x}{:x}", now.as_millis(), now.subsec_nanos())
    };
    let unique_name = format!("{}-{}", uuid, original_name);
    let dest_path = format!("{}/{}", attachments_dir, unique_name);

    // Copy file
    fs::copy(&src, &dest_path).map_err(|e| e.to_string())?;

    // Get file size
    let size = fs::metadata(&dest_path)
        .map(|m| m.len())
        .unwrap_or(0);

    Ok(serde_json::json!({
        "path": dest_path,
        "originalName": original_name,
        "uniqueName": unique_name,
        "uuid": uuid,
        "size": size
    }))
}

#[tauri::command]
fn save_attachment_content(file_name: String, content_b64: String, session_key: String) -> Result<serde_json::Value, String> {
    use std::fs;
    use base64::Engine;

    let home = std::env::var("HOME").unwrap_or_default();
    let attachments_dir = format!("{}/.quinki/attachments/{}", home, session_key);
    fs::create_dir_all(&attachments_dir).map_err(|e| e.to_string())?;

    // Generate unique name
    let uuid = {
        use std::time::{SystemTime, UNIX_EPOCH};
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        format!("{:x}{:x}", now.as_millis(), now.subsec_nanos())
    };
    let unique_name = format!("{}-{}", uuid, file_name);
    let dest_path = format!("{}/{}", attachments_dir, unique_name);

    // Decode base64 and write
    let content = base64::engine::general_purpose::STANDARD.decode(&content_b64)
        .map_err(|e| e.to_string())?;
    fs::write(&dest_path, &content).map_err(|e| e.to_string())?;

    let size = content.len();

    Ok(serde_json::json!({
        "path": dest_path,
        "originalName": file_name,
        "uniqueName": unique_name,
        "uuid": uuid,
        "size": size
    }))
}

#[tauri::command]
fn open_attachments_folder(session_key: String) -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let dir = format!("{}/.quinki/attachments/{}", home, session_key);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("open")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_longhorizon_folder(session_key: String) -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let dir = format!("{}/.quinki/longhorizon/{}", home, session_key);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("open")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_general_attachments_folder() -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let dir = format!("{}/.quinki/attachments", home);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("open")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_system_settings(pane: String) -> Result<(), String> {
    // Apre la schermata specifica di System Settings per un permesso TCC
    let url = match pane.as_str() {
        "full_disk" => "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
        "files_folders" => "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders",
        "network" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Network",
        "screen_recording" => "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        "accessibility" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        "notifications" => "x-apple.systempreferences:com.apple.preference.notifications",
        _ => return Err(format!("Unknown pane: {}", pane)),
    };
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Chiamata DIRETTA a CGPreflightScreenCaptureAccess (CoreGraphics): controlla il
// permesso Screen Recording del processo CHIAMANTE (l'app stessa), senza prompt e
// senza helper esterno. È l'API ufficiale non-invasiva.
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> u8;
}

fn check_screen_recording(_app: &tauri::AppHandle) -> bool {
    unsafe { CGPreflightScreenCaptureAccess() != 0 }
}

#[tauri::command]
fn take_screenshot(session_key: String) -> Result<String, String> {
    // Cattura lo schermo NEL processo GUI (che ha il TCC Screen Recording grant).
    // Gli agenti NON possono usare `screencapture` da CLI: il sidecar è un processo
    // orfano (PPID 1) che macOS non attribuisce al bundle → il grant non si applica.
    // Qui invece il responsible process è l'app bundle → il grant si applica.
    // Il PNG va nella cartella attachments DELLA SESSIONE (visibile da "Open Session File Folder").
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let dir = format!("{}/.quinki/attachments/{}", home, session_key);
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {}", e))?;
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
    let path = format!("{}/screenshot-{}.png", dir, ts);
    let out = std::process::Command::new("/usr/sbin/screencapture")
        .args(["-x", "-t", "png", &path])
        .output()
        .map_err(|e| format!("screencapture spawn failed: {}", e))?;
    if std::path::Path::new(&path).exists() {
        Ok(path)
    } else {
        Err(format!("screencapture failed (Screen Recording permission?): {}", String::from_utf8_lossy(&out.stderr)))
    }
}

#[tauri::command]
fn check_tcc_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let tcc_db = format!("{}/Library/Application Support/com.apple.TCC/TCC.db", home);

    // Quinki Full Disk Access: prova a LEGGERE il file TCC.db (richiede FDA, in-process).
    // È il test più affidabile: senza FDA la lettura fallisce con "permission denied".
    let quinki_fd = std::fs::read(&tcc_db).is_ok();

    // Quinki Screen Recording: chiamata diretta CGPreflightScreenCaptureAccess
    let quinki_sr = check_screen_recording(&app);

    // Expert: query TCC.db via sqlite3 (richiede FDA, che ora sappiamo se c'è)
    let mut expert_fd = false;
    let mut expert_sr = false;
    if quinki_fd {
        if let Ok(out) = std::process::Command::new("sqlite3")
            .args([&tcc_db, "SELECT service, client, auth_value FROM access WHERE client = 'com.quinki.app.expert'"])
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout);
            for line in s.lines() {
                let parts: Vec<&str> = line.split('|').collect();
                if parts.len() >= 3 {
                    let service = parts[0].trim();
                    let auth = parts[2].trim();
                    let allowed = auth == "1" || auth == "2";
                    if service == "kTCCServiceSystemPolicyAllFiles" { expert_fd = allowed; }
                    else if service == "kTCCServiceScreenCapture" { expert_sr = allowed; }
                }
            }
        }
    }

    let result = serde_json::json!({
        "quinki": { "fullDisk": quinki_fd, "screenRecording": quinki_sr },
        "expert": { "fullDisk": expert_fd, "screenRecording": expert_sr },
    });
    // Debug: scrivi il risultato su file per diagnosi
    let _ = std::fs::write("/tmp/quinki-tcc-debug.json", result.to_string());
    Ok(result)
}

#[tauri::command]
fn read_expert_tcc_status() -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let p = format!("{}/.quinki/quinki-expert-tcc.json", home);
    if !std::path::Path::new(&p).exists() {
        return Ok(serde_json::json!({ "available": false }));
    }
    let content = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(v)
}

// A4.3: legge il settings direttamente dal file (istantaneo, senza aspettare il sidecar).
// Usato all'avvio per ripristinare subito le tab installate dallo store.
#[tauri::command]
fn read_quinki_settings() -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let p = format!("{}/.quinki/quinki-settings.json", home);
    if !std::path::Path::new(&p).exists() {
        return Ok(serde_json::json!({}));
    }
    let content = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(v)
}

#[tauri::command]
fn get_sidecar_version(app: tauri::AppHandle) -> Result<String, String> {
    let mut cand = app.path().resource_dir().unwrap_or_default();
    cand.push("resources/sidecar/version.txt");
    if cand.exists() {
        if let Ok(s) = std::fs::read_to_string(&cand) { return Ok(s.trim().to_string()); }
    }
    let alt = std::path::PathBuf::from("/Applications/Quinki.app/Contents/Resources/resources/sidecar/version.txt");
    if alt.exists() {
        if let Ok(s) = std::fs::read_to_string(&alt) { return Ok(s.trim().to_string()); }
    }
    Ok("unknown".to_string())
}

#[tauri::command]
fn get_sidecar_versions() -> Result<std::collections::HashMap<String, String>, String> {
    // Version.txt dei DUE sidecar (hash git scritti dall'install): uguali = sync OK.
    let read = |p: &str| -> String {
        std::fs::read_to_string(p).map(|s| s.trim().to_string()).unwrap_or_else(|_| "not installed".to_string())
    };
    let mut out = std::collections::HashMap::new();
    out.insert("main".to_string(), read("/Applications/Quinki.app/Contents/Resources/resources/sidecar/version.txt"));
    out.insert("expert".to_string(), read("/Applications/App Expert.app/Contents/Resources/resources/sidecar/version.txt"));
    Ok(out)
}

// === A3: delegate UNUserNotificationCenter — mostra le notifiche anche in primo piano
// e gestisce il CLICK sulla notifica (apre la chat relativa) ===
static NOTIF_APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

#[cfg(target_os = "macos")]
fn setup_notification_delegate(app: &tauri::AppHandle) {
    let _ = NOTIF_APP.set(app.clone());
    use objc::runtime::{Object, Sel};
    use objc::{class, msg_send, sel, sel_impl};
    use std::os::raw::{c_char, c_void};
    unsafe extern "C" {
        fn objc_allocateClassPair(superclass: *const Object, name: *const c_char, extraBytes: usize) -> *mut Object;
        fn class_addMethod(cls: *mut Object, name: Sel, imp: *const c_void, types: *const c_char) -> bool;
        fn objc_registerClassPair(cls: *mut Object);
    }
    unsafe extern "C" fn will_present(_this: *mut Object, _cmd: Sel, _center: *mut Object, _notification: *mut Object, completion: *mut c_void) {
        // UNNotificationPresentationOptionBanner=4, Sound=1, Badge=2
        let options: u64 = 4 | 1 | 2;
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        let block = &*(completion as *const block::Block<(u64,), ()>);
        block.call((options,));
    }
    // CLICK sulla notifica → estrae la sessionKey da userInfo → focus + apre la chat
    unsafe extern "C" fn did_receive(_this: *mut Object, _cmd: Sel, _center: *mut Object, response: *mut Object, completion: *mut c_void) {
        if let Some(app) = NOTIF_APP.get() {
            unsafe {
                use objc::{class, msg_send, sel, sel_impl};
                use objc::runtime::Object;
                use std::ffi::{CStr, CString};
                let notif: *mut Object = msg_send![response, notification];
                let request: *mut Object = msg_send![notif, request];
                let content: *mut Object = msg_send![request, content];
                let user_info: *mut Object = msg_send![content, userInfo];
                if !user_info.is_null() {
                    let key_c = CString::new("sessionKey").unwrap_or_default();
                    let key_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: key_c.as_ptr()];
                    let val: *mut Object = msg_send![user_info, objectForKey: key_ns];
                    if !val.is_null() {
                        let cstr: *const c_char = msg_send![val, UTF8String];
                        if !cstr.is_null() {
                            let sk = CStr::from_ptr(cstr).to_string_lossy().into_owned();
                            if !sk.is_empty() {
                                let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
                                if let Some(win) = app.get_webview_window("main") {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                    let _ = win.emit("switch-session", &sk);
                                }
                            }
                        }
                    }
                }
            }
        }
        // completion handler (void block)
        let block = &*(completion as *const block::Block<(), ()>);
        block.call(());
    }
    unsafe {
        let superclass = class!(NSObject) as *const _ as *const Object;
        let name = b"QuinkiNotifDelegate\0".as_ptr() as *const c_char;
        let cls = objc_allocateClassPair(superclass, name, 0);
        if cls.is_null() { return; }
        let types = b"v@:@@@?\0".as_ptr() as *const c_char;
        class_addMethod(cls, sel!(userNotificationCenter:willPresentNotification:withCompletionHandler:), will_present as *const c_void, types);
        class_addMethod(cls, sel!(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:), did_receive as *const c_void, types);
        objc_registerClassPair(cls);
        let center: *mut Object = msg_send![class!(UNUserNotificationCenter), currentNotificationCenter];
        let delegate: *mut Object = msg_send![cls, new];
        let _: () = msg_send![center, setDelegate: delegate];
    }
}

fn send_macos_notification(title: &str, body: &str, subtitle: &str) {
    // UNUserNotificationCenter (mostra con firma corretta) + fallback osascript (firma ad-hoc)
    #[cfg(target_os = "macos")]
    {
        use objc::{class, msg_send, sel, sel_impl};
        use objc::runtime::Object;
        use std::ffi::CString;
        unsafe {
            let center: *mut Object = msg_send![class!(UNUserNotificationCenter), currentNotificationCenter];
            let content: *mut Object = msg_send![class!(UNMutableNotificationContent), new];
            if let (Ok(title_c), Ok(body_c)) = (CString::new(title), CString::new(body)) {
                let title_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: title_c.as_ptr()];
                let body_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: body_c.as_ptr()];
                let _: () = msg_send![content, setTitle: title_ns];
                let _: () = msg_send![content, setBody: body_ns];
                if !subtitle.is_empty() {
                    if let Ok(sub_c) = CString::new(subtitle) {
                        let sub_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: sub_c.as_ptr()];
                        let _: () = msg_send![content, setSubtitle: sub_ns];
                    }
                }
                if let Ok(id_c) = CString::new("quinki-notif") {
                    let id_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: id_c.as_ptr()];
                    let nil_obj: *mut Object = std::ptr::null_mut();
                    let req: *mut Object = msg_send![class!(UNNotificationRequest), requestWithIdentifier: id_ns content: content trigger: nil_obj];
                    let _: () = msg_send![center, addNotificationRequest: req withCompletionHandler: nil_obj];
                }
            }
        }
    }
}

#[tauri::command]
fn send_notification(app: tauri::AppHandle, title: String, body: String, subtitle: Option<String>, session_key: Option<String>) -> Result<(), String> {
    send_macos_notification(&title, &body, subtitle.as_deref().unwrap_or(""));
    // Il plugin usa notify_rust (osascript) che NON mostra notifiche per questa app.
    // Implementiamo la consegna REALE con UNUserNotificationCenter.
    #[cfg(target_os = "macos")]
    {
        use objc::{class, msg_send, sel, sel_impl};
        use objc::runtime::Object;
        use std::ffi::CString;
        unsafe {
            let center: *mut Object = msg_send![class!(UNUserNotificationCenter), currentNotificationCenter];
            let content: *mut Object = msg_send![class!(UNMutableNotificationContent), new];
            let title_c = CString::new(title.as_str()).map_err(|e| e.to_string())?;
            let body_c = CString::new(body.as_str()).map_err(|e| e.to_string())?;
            let title_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: title_c.as_ptr()];
            let body_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: body_c.as_ptr()];
            let _: () = msg_send![content, setTitle: title_ns];
            let _: () = msg_send![content, setBody: body_ns];
            // userInfo: la sessionKey serve al CLICK sulla notifica per aprire la chat
            if let Some(sk) = &session_key {
                if let Ok(sk_c) = CString::new(sk.as_str()) {
                    let sk_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: sk_c.as_ptr()];
                    let key_c = CString::new("sessionKey").map_err(|e| e.to_string())?;
                    let key_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: key_c.as_ptr()];
                    let dict: *mut Object = msg_send![class!(NSMutableDictionary), new];
                    let _: () = msg_send![dict, setObject: sk_ns forKey: key_ns];
                    let _: () = msg_send![content, setUserInfo: dict];
                }
            }
            let id_c = CString::new("quinki-notif").map_err(|e| e.to_string())?;
            let id_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: id_c.as_ptr()];
            let nil_obj: *mut Object = std::ptr::null_mut();
            let req: *mut Object = msg_send![class!(UNNotificationRequest), requestWithIdentifier: id_ns content: content trigger: nil_obj];
            // Log dell'errore di consegna (se c'è)
            let block = block::ConcreteBlock::new(move |error: *mut Object| { let _ = error; });
            let block = block.copy();
            let block_ptr: *mut std::ffi::c_void = &*block as *const _ as *mut std::ffi::c_void;
            let _: () = msg_send![center, addNotificationRequest: req withCompletionHandler: block_ptr];
            // Check dello stato del permesso (0=notDetermined 1=denied 2=authorized 3=provisional)
            let pblock = block::ConcreteBlock::new(move |settings: *mut Object| { let _ = settings; });
            let pblock = pblock.copy();
            let pblock_ptr: *mut std::ffi::c_void = &*pblock as *const _ as *mut std::ffi::c_void;
            let _: () = msg_send![center, getNotificationSettingsWithCompletionHandler: pblock_ptr];
        }
    }
    let _ = app;
    Ok(())
}

#[tauri::command]
fn request_notification_permission(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    // REVERT (01 set): osascript non è il modo giusto. UNUserNotificationCenter
    // è il metodo CORRETTO per richiedere la permission. Il problema sul Mac
    // dell'amico era la firma/notarizzazione, non il metodo di richiesta.
    #[cfg(target_os = "macos")]
    {
        use objc::{class, msg_send, sel, sel_impl};
        use objc::runtime::Object;
        unsafe {
            let cls = class!(UNUserNotificationCenter);
            let center: *mut Object = msg_send![cls, currentNotificationCenter];
            let options: u64 = 1 | 2 | 4;
            let block = block::ConcreteBlock::new(move |granted: bool, _error: *mut Object| {
                let _ = granted;
            });
            let block = block.copy();
            let block_ptr: *mut std::ffi::c_void = &*block as *const _ as *mut std::ffi::c_void;
            let _: () = msg_send![center, requestAuthorizationWithOptions: options completionHandler: block_ptr];
        }
    }
    let _ = app;
    Ok(serde_json::json!({ "permission": "requested" }))
}

#[tauri::command]
fn send_expert_test_notification() -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let flag = format!("{}/.quinki/.expert-test-notif", home);
    let _ = std::fs::write(&flag, "1");
    let _ = std::process::Command::new("open").arg("-a").arg("App Expert").spawn();
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn request_expert_notification_permission() -> Result<serde_json::Value, String> {
    // Scrive un flag file: l'App Expert (in esecuzione o al prossimo launch) lo vede
    // e richiede il SUO permesso notifiche. Funziona anche se l'Expert è già aperto.
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let flag = format!("{}/.quinki/.expert-request-notif-perm", home);
    let _ = std::fs::write(&flag, "1");
    // Apri l'Expert se non è in esecuzione (se è già aperto, il polling lo gestisce)
    let _ = std::process::Command::new("open").arg("-a").arg("App Expert").spawn();
    Ok(serde_json::json!({ "permission": "expert-flag-written" }))
}

#[tauri::command]
fn get_app_permissions() -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let p = format!("{}/.quinki/quinki-permissions.json", home);
    if !std::path::Path::new(&p).exists() {
        return Ok(serde_json::json!({ "readFilesAnywhere": false, "writeFilesAnywhere": false, "executeCommands": true, "networkAccess": false, "openApps": false, "installPackages": false }));
    }
    let content = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(v)
}

#[tauri::command]
fn set_app_permissions(patch: serde_json::Value) -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let p = format!("{}/.quinki/quinki-permissions.json", home);
    let mut cur: serde_json::Value = serde_json::json!({ "readFilesAnywhere": false, "writeFilesAnywhere": false, "executeCommands": true, "networkAccess": false, "openApps": false, "installPackages": false });
    if std::path::Path::new(&p).exists() {
        if let Ok(content) = std::fs::read_to_string(&p) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                cur = v;
            }
        }
    }
    if let (Some(obj), Some(patch_obj)) = (cur.as_object_mut(), patch.as_object()) {
        for (k, v) in patch_obj {
            obj.insert(k.clone(), v.clone());
        }
    }
    let _ = std::fs::create_dir_all(format!("{}/.quinki", home));
    std::fs::write(&p, cur.to_string()).map_err(|e| e.to_string())?;
    Ok(cur)
}

#[tauri::command]
fn get_authorized_folders() -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let p = format!("{}/.quinki/quinki-authorized-folders.json", home);
    if !std::path::Path::new(&p).exists() {
        return Ok(serde_json::json!({ "folders": [] }));
    }
    let content = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(v)
}

#[tauri::command]
fn add_authorized_folder(folder: String) -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let p = format!("{}/.quinki/quinki-authorized-folders.json", home);
    let mut folders: Vec<String> = Vec::new();
    if std::path::Path::new(&p).exists() {
        if let Ok(content) = std::fs::read_to_string(&p) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(arr) = v.get("folders").and_then(|f| f.as_array()) {
                    folders = arr.iter().filter_map(|x| x.as_str().map(String::from)).collect();
                }
            }
        }
    }
    if !folders.contains(&folder) {
        folders.push(folder);
    }
    let _ = std::fs::create_dir_all(format!("{}/.quinki", home));
    std::fs::write(&p, serde_json::json!({ "folders": folders }).to_string()).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "folders": folders }))
}

#[tauri::command]
fn remove_authorized_folder(folder: String) -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let p = format!("{}/.quinki/quinki-authorized-folders.json", home);
    let mut folders: Vec<String> = Vec::new();
    if std::path::Path::new(&p).exists() {
        if let Ok(content) = std::fs::read_to_string(&p) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(arr) = v.get("folders").and_then(|f| f.as_array()) {
                    folders = arr.iter().filter_map(|x| x.as_str().map(String::from)).collect();
                }
            }
        }
    }
    folders.retain(|f| f != &folder);
    let _ = std::fs::create_dir_all(format!("{}/.quinki", home));
    std::fs::write(&p, serde_json::json!({ "folders": folders }).to_string()).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "folders": folders }))
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_attachments(session_key: String) -> Result<Vec<serde_json::Value>, String> {
    use std::fs;
    use std::path::Path;
    let home = std::env::var("HOME").unwrap_or_default();
    let dir = format!("{}/.quinki/attachments/{}", home, session_key);

    if !Path::new(&dir).exists() {
        return Ok(vec![]);
    }

    let mut files = vec![];
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_file() {
                let name = entry.file_name().to_string_lossy().to_string();
                // Skip hidden files (e.g. .DS_Store)
                if name.starts_with('.') { continue; }
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                // Extract original name by removing the uuid prefix (first 20+ chars before first '-')
                let original_name = if let Some(idx) = name.find('-') {
                    name[idx+1..].to_string()
                } else {
                    name.clone()
                };
                files.push(serde_json::json!({
                    "name": name,
                    "originalName": original_name,
                    "path": path.to_string_lossy().to_string(),
                    "size": size
                }));
            }
        }
    }
    // Sort by name
    files.sort_by(|a, b| {
        a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))
    });
    Ok(files)
}

#[tauri::command]
fn install_main_app(build_path: String) -> Result<String, String> {
    // Safely install the main app WITHOUT touching the Expert app
    // 1. Backup current main app
    // 2. Install new build
    // 3. Kill only the main sidecar (port 9182)
    // 4. Restart main app
    
    let main_app = "/Applications/Quinki.app";
    let backup = "/Applications/Quinki.app.bak";
    
    // Backup
    if std::path::Path::new(main_app).exists() {
        let _ = std::fs::remove_dir_all(backup);
        std::fs::rename(main_app, backup).map_err(|e| format!("Backup failed: {}", e))?;
    }
    
    // Install new build
    std::process::Command::new("ditto")
        .args([&build_path, main_app])
        .output()
        .map_err(|e| format!("Install failed: {}", e))?;
    
    // Kill main sidecar (ONLY port 9182, never 9183)
    let _ = std::process::Command::new("sh")
        .args(["-c", "lsof -ti:9182 | xargs kill -9 2>/dev/null"])
        .output();
    
    // Clear webview caches
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let _ = std::fs::remove_dir_all(format!("{}/Library/WebKit/com.quinki.app", home));
    let _ = std::fs::remove_dir_all(format!("{}/Library/Caches/com.quinki.app", home));
    
    // Restart main app
    std::thread::sleep(std::time::Duration::from_secs(1));
    let _ = std::process::Command::new("open")
        .arg(main_app)
        .spawn();
    
    // Clean up backup
    std::thread::sleep(std::time::Duration::from_secs(2));
    let _ = std::fs::remove_dir_all(backup);
    
    Ok("Main app installed and restarted".to_string())
}

#[tauri::command]
fn restart_main_app() -> Result<String, String> {
    // Kill ONLY the main sidecar (port 9182) and restart the main app
    let _ = std::process::Command::new("sh")
        .args(["-c", "lsof -ti:9182 | xargs kill -9 2>/dev/null"])
        .output();
    
    std::thread::sleep(std::time::Duration::from_secs(1));
    
    let _ = std::process::Command::new("open")
        .arg("/Applications/Quinki.app")
        .spawn();
    
    Ok("Main app restarted".to_string())
}


// === Update check con dialoghi nativi macOS (menu App → Check for Update) ===
fn check_for_update_dialog(app: tauri::AppHandle) {
    use tauri_plugin_dialog::DialogExt;
    let app = app.clone();
    std::thread::spawn(move || {
        let app_name = if is_expert_mode() { "App Expert" } else { "Quinki" }.to_string();
        let out = std::process::Command::new("curl")
            .args(["-fsSL", "https://api.github.com/repos/Upward991/Quinki/releases?per_page=1"])
            .output();
        let Ok(out) = out else {
            app.dialog().message("Could not check for updates (network error).").title(app_name).show(|_| {});
            return;
        };
        let json: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or(serde_json::Value::Null);
        let Some(first) = json.as_array().and_then(|a| a.first()).cloned() else {
            app.dialog().message("Could not check for updates (unexpected response).").title(app_name).show(|_| {});
            return;
        };
        let tag = first.get("tag_name").and_then(|t| t.as_str()).unwrap_or("").to_string();
        let dmg_url = first.get("assets")
            .and_then(|a| a.as_array())
            .and_then(|assets| assets.iter().find(|a| {
                a.get("name").and_then(|n| n.as_str()).map(|n| n.to_lowercase().ends_with(".dmg")).unwrap_or(false)
            }))
            .and_then(|a| a.get("browser_download_url"))
            .and_then(|u| u.as_str())
            .unwrap_or("")
            .to_string();
        let current = app.package_info().version.to_string();
        let latest = tag.trim_start_matches('v').to_string();
        if latest.is_empty() {
            app.dialog().message("Could not check for updates (unexpected response).").title(app_name).show(|_| {});
            return;
        }
        if latest != current && latest > current {
            let app_c = app.clone();
            app.dialog()
                .message(format!("Quinki {} is available (you have v{}). Update now?", latest, current))
                .title("Update available")
                .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom("Update now".into(), "Later".into()))
                .show(move |update_now| {
                    if update_now {
                        let app2 = app_c.clone();
                        let dmg = dmg_url.clone();
                        let expert = is_expert_mode();
                        std::thread::spawn(move || {
                            match apply_update(dmg, expert) {
                                Ok(_) => { /* apply_update riavvia la main app in detach */ }
                                Err(e) => {
                                    app2.dialog().message(format!("Update failed: {}", e)).title("Update failed").show(|_| {});
                                }
                            }
                        });
                    }
                });
        } else {
            app.dialog().message(format!("You're up to date (v{}).", current)).title(app_name).show(|_| {});
        }
    });
}

#[tauri::command]
fn apply_update(dmg_url: String, sync_expert: bool) -> Result<String, String> {
    // Manual update from Settings → Versions. Downloads the released DMG from GitHub,
    // installs the MAIN app (with backup), optionally syncs the App Expert,
    // then restarts the main app. NEVER touches anything else.
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let upd = format!("{}/.quinki/update", home);
    let _ = std::fs::create_dir_all(&upd);
    let dmg = format!("{}/Quinki-update.dmg", upd);
    let _ = std::fs::remove_file(&dmg);

    // 1) download the DMG
    let st = std::process::Command::new("curl")
        .args(["-L", "-s", "-o", &dmg, &dmg_url])
        .status()
        .map_err(|e| format!("download failed: {}", e))?;
    if !st.success() {
        return Err("download failed".to_string());
    }

    // 2) mount the DMG
    let out = std::process::Command::new("hdiutil")
        .args(["attach", "-nobrowse", &dmg])
        .output()
        .map_err(|e| format!("mount failed: {}", e))?;
    if !out.status.success() {
        return Err(".mount failed".to_string());
    }
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    let mount = text
        .lines()
        .last()
        .and_then(|l| l.split_whitespace().last())
        .unwrap_or("")
        .to_string();
    if mount.is_empty() {
        return Err("could not find mount point".to_string());
    }
    let src = format!("{}/Quinki.app", mount);
    if !std::path::Path::new(&src).exists() {
        let _ = std::process::Command::new("hdiutil").args(["detach", &mount]).status();
        return Err("Quinki.app not found in DMG".to_string());
    }

    // 3) install main (backup + ditto)
    let main = "/Applications/Quinki.app";
    if std::path::Path::new(main).exists() {
        let _ = std::fs::remove_dir_all(format!("{}.bak", main));
        std::fs::rename(main, format!("{}.bak", main)).map_err(|e| format!("backup failed: {}", e))?;
    }
    std::process::Command::new("ditto")
        .args([&src, main])
        .status()
        .map_err(|e| format!("install failed: {}", e))?;

    // 4) optional sync App Expert
    if sync_expert {
        let exp = "/Applications/App Expert.app";
        if std::path::Path::new(exp).exists()
            && std::path::Path::new("/Applications/Quinki.app/Contents/MacOS/quinki").exists()
        {
            let _ = std::fs::copy(
                "/Applications/Quinki.app/Contents/MacOS/quinki",
                format!("{}/Contents/MacOS/quinki", exp),
            );
            let _ = std::fs::remove_dir_all(format!("{}/Contents/Resources/resources/sidecar", exp));
            let _ = std::process::Command::new("ditto")
                .args([
                    "/Applications/Quinki.app/Contents/Resources/resources/sidecar",
                    &format!("{}/Contents/Resources/resources/sidecar", exp),
                ])
                .status();
            // Scrivi il flag di riavvio: così l'App Expert mostra il badge
            // "App synced. Restart to apply!" in alto a destra (vera conferma del sync).
            let flag = format!("{}/.quinki/.expert-needs-restart", home);
            let _ = std::fs::write(&flag, "1");
        }
    }

    // 5) unmount + cleanup (but keep the dmg for re-install if needed)
    let _ = std::process::Command::new("hdiutil").args(["detach", &mount]).status();

    // 6) detached restart: kill main sidecar + main process, then reopen
    let _ = std::process::Command::new("nohup")
        .args([
            "sh", "-c",
            &format!("sleep 1; lsof -ti:9182 | xargs kill -9 2>/dev/null; pkill -f \"/Applications/Quinki.app/Contents/MacOS/quinki\" 2>/dev/null; sleep 1; open /Applications/Quinki.app"),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("restart spawn failed: {}", e))?;

    Ok("Update applied. Quinki is restarting.".to_string())
}


#[tauri::command]
fn check_expert_installed() -> Result<bool, String> {
    Ok(std::path::Path::new("/Applications/App Expert.app").exists())
}

#[tauri::command]
fn is_expert_app_running() -> Result<bool, String> {
    // True only if the App Expert app PROCESS is running. Matches the app
    // binary path only: the sidecar lives under Resources/ (no /MacOS/) and
    // the watchdog is a shell script, so they never match. Used by the main
    // app to hard-lock the backup Expert tab while the real app is open, so
    // the __app_expert__ session can NEVER run/show in the main app then.
    let out = std::process::Command::new("pgrep")
        .args(["-f", "/Applications/App Expert.app/Contents/MacOS/"])
        .output()
        .map_err(|e| format!("pgrep failed: {}", e))?;
    Ok(out.status.success())
}

#[tauri::command]
fn install_expert_app() -> Result<String, String> {
    // Copy the main app to /Applications/App Expert.app with expert identity
    let main_app = "/Applications/Quinki.app";
    let expert_app = "/Applications/App Expert.app";
    
    if !std::path::Path::new(main_app).exists() {
        return Err("Quinki.app not found. Install Quinki first.".to_string());
    }
    
    // Remove old Expert app if exists
    let _ = std::fs::remove_dir_all(expert_app);
    
    // Copy main app as Expert app base
    std::process::Command::new("ditto")
        .args([main_app, expert_app])
        .output()
        .map_err(|e| format!("Copy failed: {}", e))?;
    
    // Modify Info.plist — separate app identity
    let plist = format!("{}/Contents/Info.plist", expert_app);
    let main_bundle_id = std::process::Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleIdentifier", &plist])
        .output()
        .map_err(|e| e.to_string())?;
    let bundle_id = String::from_utf8_lossy(&main_bundle_id.stdout).trim().to_string();
    
    let _ = std::process::Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Set :CFBundleName App Expert", &plist])
        .output();
    let _ = std::process::Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Set :CFBundleDisplayName App Expert", &plist])
        .output();
    let _ = std::process::Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", &format!("Set :CFBundleIdentifier {}.expert", bundle_id), &plist])
        .output();
    
    // Copy expert icon — BUNDLED (29 ago): l'icona è DENTRO il bundle Quinki.app
    // (resources/expert-icon.icns), NON nel filesystem dello sviluppatore.
    // Prima usava $HOME/Projects/Quinki/... che NON ESISTE sul Mac dell'utente
    // → l'icona non veniva MAI copiata sulle installazioni pubbliche.
    let bundled_icon = format!("{}/Contents/Resources/resources/expert-icon.icns", expert_app);
    let plist = format!("{}/Contents/Info.plist", expert_app);
    if std::path::Path::new(&bundled_icon).exists() {
        let _ = std::fs::copy(&bundled_icon, format!("{}/Contents/Resources/icon.icns", expert_app));
        let _ = std::process::Command::new("/usr/libexec/PlistBuddy")
            .args(["-c", "Set :CFBundleIconFile icon", &plist])
            .output();
        // Refresh Dock icon cache
        let _ = std::process::Command::new("touch").arg(expert_app).output();
    }
    
    // Refresh Dock
    let _ = std::process::Command::new("killall").arg("Dock").output();
    
    Ok("App Expert.app installed".to_string())
}

#[tauri::command]
fn sync_expert_app() -> Result<String, String> {
    // Copy binary + sidecar from main app to Expert app (sync new code)
    // OGNI step è VERIFICATO: si dichiara "synced" SOLO se la copia è davvero
    // avvenuta (binario presente/non vuoto, ditto riuscito, flag scritto).
    let main_app = "/Applications/Quinki.app";
    let expert_app = "/Applications/App Expert.app";
    
    if !std::path::Path::new(main_app).exists() {
        return Err("Quinki.app not found.".to_string());
    }
    if !std::path::Path::new(expert_app).exists() {
        return Err("App Expert.app not found. Install it first.".to_string());
    }

    // === HEALTH GUARD (29 ago — richiesta utente): MAI sincronizzare una build
    // rotta. Se il sidecar della Main NON risponde (app appena schiantata, build
    // difettosa, boot fallito), il sync si RIFIUTA: la Main deve essere viva e
    // sana prima di poter infettare l'Expert. Prima copiava comunque, e una
    // Main rotta rompeva anche l'Expert.
    {
        let probe = std::process::Command::new("bash")
            .arg("-c")
            .arg("exec 3<>/dev/tcp/127.0.0.1/9182 && exec 3>&- && echo ok")
            .output();
        let alive = matches!(probe, Ok(ref o) if o.status.success());
        if !alive {
            return Err("The main app sidecar is not responding. Fix the main app before syncing: a broken build must never be copied to the App Expert.".to_string());
        }
    }
    
    // === Backup del binario + sidecar attuali dell'Expert (per rollback) ===
    // Prima di sincronizzare, salva la versione corrente: se il sync rompe l'Expert,
    // l'utente può tornare indietro con "Rollback App Expert".
    let home_bk = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let backup_root = format!("{}/.quinki/backups", home_bk);
    let ts_bk = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let backup_dir = format!("{}/expert-{}", backup_root, ts_bk);
    let expert_bin = format!("{}/Contents/MacOS/quinki", expert_app);
    let expert_sidecar = format!("{}/Contents/Resources/resources/sidecar", expert_app);
    if std::path::Path::new(&expert_bin).exists() {
        let _ = std::fs::create_dir_all(&backup_dir);
        let _ = std::fs::copy(&expert_bin, format!("{}/quinki", backup_dir));
    }
    if std::path::Path::new(&expert_sidecar).exists() {
        let _ = std::fs::create_dir_all(&backup_dir);
        let _ = std::process::Command::new("ditto")
            .args([&expert_sidecar, &format!("{}/sidecar", backup_dir)])
            .status();
    }
    // Mantieni solo gli ultimi 5 backup
    if let Ok(rd) = std::fs::read_dir(&backup_root) {
        let mut backups: Vec<String> = rd.filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("expert-"))
            .map(|e| e.path().to_string_lossy().to_string())
            .collect();
        backups.sort();
        while backups.len() > 5 {
            let old = backups.remove(0);
            let _ = std::fs::remove_dir_all(&old);
        }
    }

    // Copy binary (fallisce subito se la copia non riesce)
    let main_bin = format!("{}/Contents/MacOS/quinki", main_app);
    std::fs::copy(&main_bin, &expert_bin).map_err(|e| format!("Binary copy failed: {}", e))?;
    
    // Copy sidecar resources con controllo di successo (prima l'esito NON era
    // controllato → il sync poteva dichiararsi completo anche se ditto falliva)
    let main_sidecar = format!("{}/Contents/Resources/resources/sidecar", main_app);
    
    let _ = std::fs::remove_dir_all(&expert_sidecar);
    let ditto_st = std::process::Command::new("ditto")
        .args([&main_sidecar, &expert_sidecar])
        .status()
        .map_err(|e| format!("Sidecar copy failed: {}", e))?;
    if !ditto_st.success() {
        return Err("Sidecar copy failed (ditto). Nothing was marked as synced.".to_string());
    }
    
    // Verifica reale che i file esistano e non siano vuoti
    let bin_ok = std::fs::metadata(&expert_bin).map(|m| m.len() > 0).unwrap_or(false);
    if !bin_ok {
        return Err("Sync failed: Expert binary is missing or empty after copy.".to_string());
    }
    let sidecar_bin = format!("{}/quinki-sidecar-ws", expert_sidecar);
    if !std::path::Path::new(&sidecar_bin).exists() {
        return Err("Sync failed: Expert sidecar binary is missing after copy.".to_string());
    }
    
    // FIX nome: il sync DEVE aggiornare anche CFBundleName/DisplayName (altrimenti
    // l'Expert resta "Quinki Expert" nel menu Uscita forzata di macOS).
    let plist = format!("{}/Contents/Info.plist", expert_app);
    let _ = std::process::Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Set :CFBundleName App Expert", &plist])
        .output();
    let _ = std::process::Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Set :CFBundleDisplayName App Expert", &plist])
        .output();

    // Re-sign con requirement STABILE (identifier-based, non cdhash): così i permessi
    // TCC dell'Expert (Full Disk Access, Screen Recording) sopravvivono ai sync/reinstall.
    let _ = std::process::Command::new("codesign")
        .args(["--force", "--sign", "-", "--identifier", "com.quinki.app.expert", "--requirements", "=designated => identifier \"com.quinki.app.expert\"", "--deep", expert_app])
        .output();

    // FIX DOPPIO RESTART (29 ago, ordine utente): il sync NON scrive piu' il flag.
    // Prima: sync (flag #1) + pressione del bottone restart (flag #2) = DUE riavvii.
    // Ora: il sync copia SOLO i file; il riavvio lo decide l'utente col bottone —
    // una pressione = un riavvio, N pressioni = N riavvii. La pill 'Update
    // available' appare comunque (confronto versioni), il bottone fa il resto.
    Ok("Expert app synced. Press restart in the Expert app when you want to apply.".to_string())
}

#[tauri::command]
fn rollback_expert_app() -> Result<String, String> {
    // Ripristina l'ultimo backup del binario + sidecar dell'App Expert
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let backup_root = format!("{}/.quinki/backups", home);
    if !std::path::Path::new(&backup_root).exists() {
        return Err("No backups found. Sync the Expert at least once first.".to_string());
    }
    let mut backups: Vec<String> = std::fs::read_dir(&backup_root)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("expert-"))
        .map(|e| e.path().to_string_lossy().to_string())
        .collect();
    backups.sort();
    let latest = backups.last().ok_or("No backups found. Sync the Expert at least once first.".to_string())?;

    let expert_app = "/Applications/App Expert.app";
    if !std::path::Path::new(expert_app).exists() {
        return Err("App Expert.app not found.".to_string());
    }
    let expert_bin = format!("{}/Contents/MacOS/quinki", expert_app);
    let expert_sidecar = format!("{}/Contents/Resources/resources/sidecar", expert_app);

    // Ripristina binario
    std::fs::copy(format!("{}/quinki", latest), &expert_bin)
        .map_err(|e| format!("Binary restore failed: {}", e))?;
    // Ripristina sidecar
    let _ = std::fs::remove_dir_all(&expert_sidecar);
    let ditto_st = std::process::Command::new("ditto")
        .args([&format!("{}/sidecar", latest), &expert_sidecar])
        .status()
        .map_err(|e| format!("Sidecar restore failed: {}", e))?;
    if !ditto_st.success() {
        return Err("Sidecar restore failed (ditto).".to_string());
    }

    // NIENTE riavvio automatico: il frontend mostra il modale con Restart (se l'app
    // è in esecuzione) o Done (se è chiusa). Il riavvio lo fa l'utente col bottone Restart.

        // Re-sign: il rollback ripristina file con firma stale — senza re-sign il
    // bundle ha firma INVALIDA e macOS invalida i permessi TCC (ri-prompt ogni volta).
    let _ = std::process::Command::new("codesign")
        .args(["--force", "--sign", "-", "--identifier", "com.quinki.app.expert", "--requirements", "=designated => identifier \"com.quinki.app.expert\"", "--deep", "/Applications/App Expert.app"])
        .output();
    Ok("App Expert rolled back to the previous version.".to_string())
}

#[tauri::command]
fn check_expert_backup_exists() -> Result<bool, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let backup_root = format!("{}/.quinki/backups", home);
    if !std::path::Path::new(&backup_root).exists() { return Ok(false); }
    let any = std::fs::read_dir(&backup_root)
        .map(|rd| rd.filter_map(|e| e.ok()).any(|e| e.file_name().to_string_lossy().starts_with("expert-")))
        .unwrap_or(false);
    Ok(any)
}

#[tauri::command]
fn restart_expert_app() {
    // FIX (29 ago — il bug "niente streaming nell'app Expert + pill Running
    // bloccata"): restart_expert_app KILLAVA il sidecar Expert DIRETTAMENTE,
    // anche a metà turno → lo streaming moriva e il recovery (se il restart
    // superava la grace) faceva adottare il turno alla MAIN → streaming
    // visibile solo nella Main. Ora NON killa MAI: scrive il flag → l'app
    // Expert (che lo polla ogni 5s) si riavvia DA SOLA con
    // expert_self_restart_now SOLO quando il turno è finito (idle).
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let flag = format!("{}/.quinki/.expert-needs-restart", home);
    let _ = std::fs::write(&flag, "1");
}

#[tauri::command]
fn expert_self_restart_now(app: tauri::AppHandle) {
    // Il restart VERO: invocato SOLO dall'app Expert a turno finito (il frontend
    // controlla !isStreaming prima di chiamarlo). Chiude backend + app e si riapre.
    if !is_expert_mode() { return; }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let flag = format!("{}/.quinki/.expert-needs-restart", home);
    let _ = std::fs::remove_file(&flag);
    // DEBOUNCE (29 ago — bug 'il sync fa riavviare l'Expert DUE volte'): sync e
    // pill scrivono ENTRAMBI il flag; se il secondo arriva mentre/dopo il primo
    // restart, l'app riapriva e ripartiva subito ancora. Ora segno QUANDO è
    // avvenuto l'ultimo restart: expert_restart_pending consuma in silenzio
    // qualunque flag arrivi entro 30s → MAI due restart di fila.
    let now_secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    let _ = std::fs::write(format!("{}/.quinki/.expert-last-restart", home), now_secs.to_string());
    kill_backend();
    SHOULD_EXIT.store(true, Ordering::SeqCst);
    let _ = std::process::Command::new("sh").arg("-c")
      .arg("nohup sh -c 'sleep 1; open \"/Applications/App Expert.app\"' >/dev/null 2>&1 &")
      .spawn();
    std::thread::sleep(std::time::Duration::from_millis(300));
    app.exit(0);
}

#[tauri::command]
fn expert_restart_pending() -> Result<bool, String> {
    // True SOLO se c'è il flag di restart richiesto (sync completato o restart
    // cliccato): il frontend Expert lo polla e si riavvia quando è idle.
    // NESSUN debounce (29 ago, rimosso su richiesta utente): l'utente deve poter
    // restartare a ripetizione manualmente quante volte vuole.
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    Ok(std::path::Path::new(&format!("{}/.quinki/.expert-needs-restart", home)).exists())
}

// Legge il version.txt (git hash) di un bundle: è stabile rispetto alla firma
// (stesso codice = stesso hash, anche se gli MD5 del binario differiscono per il codesign).
fn read_version_txt(app_root: &str) -> Option<String> {
    let p = format!("{}/Contents/Resources/resources/sidecar/version.txt", app_root);
    let s = std::fs::read_to_string(&p).ok()?;
    Some(s.trim().to_string())
}

#[tauri::command]
fn check_expert_needs_restart() -> Result<bool, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let stored_path = format!("{}/.quinki/.expert-running-build.json", home);

    // 1) L'Expert è stato sincronizzato ma NON riavviato: il bundle attuale dell'Expert
    // differisce da quello registrato all'ultimo avvio → badge.
    let stored = std::fs::read_to_string(&stored_path).ok();
    let stored = stored.map(|t| {
        let b = t.split("\"binary\":\"").nth(1).and_then(|r| r.split('"').next()).map(String::from);
        let s = t.split("\"sidecar\":\"").nth(1).and_then(|r| r.split('"').next()).map(String::from);
        (b, s)
    });
    if let Some((Some(sb), Some(ss))) = &stored {
        if let Some((eb, es)) = app_build_fingerprint("/Applications/App Expert.app") {
            if eb != *sb || es != *ss { return Ok(true); }
        }
    } else {
        // Mai registrato: registra ora (niente falsi positivi al primo avvio)
        record_running_build();
    }

    // 2) La MAIN ha una versione più nuova dell'Expert (version.txt diversi) →
    // "Update available. Sync and restart to apply." (confronto stabile rispetto alla firma).
    if let (Some(mv), Some(ev)) = (read_version_txt("/Applications/Quinki.app"), read_version_txt("/Applications/App Expert.app")) {
        if !mv.is_empty() && !ev.is_empty() && mv != ev { return Ok(true); }
    }

    Ok(false)
}

#[tauri::command]
fn check_expert_running() -> Result<bool, String> {
    // Controlla il PROCESSO dell'app Expert (non la porta 9183: il sidecar può
    // restare orfano quando l'app è chiusa, e darebbe un falso "in esecuzione").
    let output = std::process::Command::new("sh")
        .args(["-c", "pgrep -f '/Applications/App Expert.app/Contents/MacOS/quinki' 2>/dev/null"])
        .output()
        .map_err(|e| e.to_string())?;
    let running = !output.stdout.is_empty();
    let _ = std::fs::write("/tmp/quinki-expert-running-debug.txt", format!("running={} stdout={:?}", running, String::from_utf8_lossy(&output.stdout)));
    Ok(running)
}

#[tauri::command]
fn open_expert_app() -> Result<(), String> {
    // Look for App Expert.app as a separate app in /Applications
    let expert_paths = [
        "/Applications/App Expert.app".to_string(),
        {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
            format!("{}/Applications/App Expert.app", home)
        },
    ];
    
    for path in &expert_paths {
        let expert_app = std::path::Path::new(path);
        if expert_app.exists() {
            std::process::Command::new("open")
                .arg(expert_app)
                .spawn()
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    
    Err("App Expert.app not found. Install it separately.".to_string())
}

#[tauri::command]
fn sync_from_main() -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let main_dir = format!("{}/.quinki", home);
    let expert_dir = format!("{}/.quinki-expert", home);
    if !std::path::Path::new(&main_dir).exists() { return Err("Main data directory not found".to_string()); }
    std::fs::create_dir_all(&expert_dir).map_err(|e| e.to_string())?;
    let mut copied = 0;
    let main_agents = format!("{}/agents", main_dir);
    let expert_agents = format!("{}/agents", expert_dir);
    if std::path::Path::new(&main_agents).exists() {
        let _ = std::fs::remove_dir_all(&expert_agents);
        copy_dir_recursive(&main_agents, &expert_agents)?;
        copied += count_items(&expert_agents);
    }
    let main_skills = format!("{}/skills", main_dir);
    let expert_skills = format!("{}/skills", expert_dir);
    if std::path::Path::new(&main_skills).exists() {
        let _ = std::fs::remove_dir_all(&expert_skills);
        copy_dir_recursive(&main_skills, &expert_skills)?;
        copied += count_items(&expert_skills);
    }
    for f in &["quinki-providers.json", "dashboard-providers.json", "quinki-global.json", "dashboard-global.json"] {
        let src = format!("{}/{}", main_dir, f);
        let dst = format!("{}/{}", expert_dir, f);
        if std::path::Path::new(&src).exists() && !std::path::Path::new(&dst).is_symlink() {
            std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
            copied += 1;
        }
    }
    Ok(format!("Synced {} items from Main to Expert", copied))
}

#[tauri::command]
fn sync_from_expert() -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let main_dir = format!("{}/.quinki", home);
    let expert_dir = format!("{}/.quinki-expert", home);
    if !std::path::Path::new(&expert_dir).exists() { return Err("Expert data directory not found".to_string()); }
    let mut copied = 0;
    let main_agents = format!("{}/agents", main_dir);
    let expert_agents = format!("{}/agents", expert_dir);
    if std::path::Path::new(&expert_agents).exists() {
        let _ = std::fs::remove_dir_all(&main_agents);
        copy_dir_recursive(&expert_agents, &main_agents)?;
        copied += count_items(&main_agents);
    }
    let main_skills = format!("{}/skills", main_dir);
    let expert_skills = format!("{}/skills", expert_dir);
    if std::path::Path::new(&expert_skills).exists() {
        let _ = std::fs::remove_dir_all(&main_skills);
        copy_dir_recursive(&expert_skills, &main_skills)?;
        copied += count_items(&main_skills);
    }
    for f in &["quinki-providers.json", "dashboard-providers.json", "quinki-global.json", "dashboard-global.json"] {
        let src = format!("{}/{}", expert_dir, f);
        let dst = format!("{}/{}", main_dir, f);
        if std::path::Path::new(&src).exists() && !std::path::Path::new(&dst).is_symlink() {
            std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
            copied += 1;
        }
    }
    Ok(format!("Synced {} items from Expert to Main", copied))
}

fn copy_dir_recursive(src: &str, dst: &str) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = std::path::Path::new(dst).join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(src_path.to_str().unwrap_or(""), dst_path.to_str().unwrap_or(""))?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn count_items(dir: &str) -> usize {
    std::fs::read_dir(dir).map(|it| it.count()).unwrap_or(0)
}

#[tauri::command]
fn kill_backend() {
    // SINCRONO (status()): il kill DEVE essere completato prima di uscire, altrimenti
    // il sidecar sopravvive alla chiusura (race). Copre tutte le vie di quit.
    if is_expert_mode() {
        // Watchdog PRIMA (niente race di riaccensione), poi sidecar (porta + percorso binario)
        let _ = std::process::Command::new("sh").arg("-c")
          .arg("pkill -f 'start-expert.sh' 2>/dev/null; pkill -f expert-watchdog 2>/dev/null; sleep 0.2; lsof -ti:9183 | xargs kill -9 2>/dev/null; pkill -9 -f 'App Expert.app/Contents/Resources/resources/sidecar/quinki-sidecar-w[s]' 2>/dev/null; true")
          .status();
    } else {
        // Sidecar main: porta 9182 + percorso binario (bracket trick per non matchare la shell stessa)
        let _ = std::process::Command::new("sh").arg("-c")
          .arg("lsof -ti:9182 | xargs kill -9 2>/dev/null; pkill -9 -f 'Quinki.app/Contents/Resources/resources/sidecar/quinki-sidecar-w[s]' 2>/dev/null; true")
          .status();
    }
}

#[cfg(target_os = "macos")]
fn start_test_bridge(app: tauri::AppHandle) {
    if std::env::var("QUINKI_TEST_BRIDGE").ok().as_deref() != Some("1") {
        return;
    }
    std::thread::spawn(move || {
        use std::io::{Read, Write};
        use tauri::Manager;
        if let Ok(listener) = std::net::TcpListener::bind("127.0.0.1:9555") {
            eprintln!("[test-bridge] listening on 127.0.0.1:9555");
            for stream in listener.incoming() {
                if let Ok(mut stream) = stream {
                    let mut buf: Vec<u8> = Vec::new();
                    let mut tmp = [0u8; 16384];
                    loop {
                        match stream.read(&mut tmp) {
                            Ok(0) => break,
                            Ok(n) => buf.extend_from_slice(&tmp[..n]),
                            Err(_) => break,
                        }
                        if buf.len() > 4_000_000 { break; }
                    }
                    let js = String::from_utf8_lossy(&buf).trim().to_string();
                    if !js.is_empty() {
                        let app2 = app.clone();
                        if let Some(w) = app2.get_webview_window("main") {
                            let _ = w.eval(&js);
                        }
                    }
                    let _ = stream.write_all(b"ok");
                }
            }
        }
    });
}

fn native_quit_confirm(app_name: &str) -> bool {
    // NSAlert nativo: il tray è l'unico modo di chiudere senza UI → conferma di sistema.
    use objc::{class, msg_send, sel, sel_impl};
    use objc::runtime::Object;
    use std::ffi::CString;
    unsafe {
        let alert: *mut Object = msg_send![class!(NSAlert), new];
        let title = format!("Quit {}?", app_name);
        let info = "Quitting closes the app and its background service. The recovery system resumes interrupted messages and tasks automatically the next time you open the app.";
        let t_c = CString::new(title).unwrap_or_default();
        let i_c = CString::new(info).unwrap_or_default();
        let t_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: t_c.as_ptr()];
        let i_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: i_c.as_ptr()];
        let _: () = msg_send![alert, setMessageText: t_ns];
        let _: () = msg_send![alert, setInformativeText: i_ns];
        let q_c = CString::new("Quit App").unwrap_or_default();
        let c_c = CString::new("Cancel").unwrap_or_default();
        let q_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: q_c.as_ptr()];
        let c_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: c_c.as_ptr()];
        let _: () = msg_send![alert, addButtonWithTitle: q_ns];
        let _: () = msg_send![alert, addButtonWithTitle: c_ns];
        let ret: isize = msg_send![alert, runModal];
        let _: () = msg_send![alert, release];
        ret == 1000
    }
}
#[cfg(not(target_os = "macos"))]
fn native_quit_confirm(_app_name: &str) -> bool { true }

/// FIX: conferma nativa anche per il RESTART dal tray — come il quit, ma con
/// testo e bottone dedicati (il restart involontario è pericoloso quanto il quit).
#[cfg(target_os = "macos")]
fn native_restart_confirm(app_name: &str) -> bool {
    use objc::{class, msg_send, sel, sel_impl};
    use objc::runtime::Object;
    use std::ffi::CString;
    unsafe {
        let alert: *mut Object = msg_send![class!(NSAlert), new];
        let title = format!("Restart {}?", app_name);
        let info = "Restarting closes the app and its background service, then reopens it automatically. The recovery system resumes interrupted messages and tasks after the restart.";
        let t_c = CString::new(title).unwrap_or_default();
        let i_c = CString::new(info).unwrap_or_default();
        let t_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: t_c.as_ptr()];
        let i_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: i_c.as_ptr()];
        let _: () = msg_send![alert, setMessageText: t_ns];
        let _: () = msg_send![alert, setInformativeText: i_ns];
        let r_c = CString::new("Restart App").unwrap_or_default();
        let c_c = CString::new("Cancel").unwrap_or_default();
        let r_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: r_c.as_ptr()];
        let c_ns: *mut Object = msg_send![class!(NSString), stringWithUTF8String: c_c.as_ptr()];
        let _: () = msg_send![alert, addButtonWithTitle: r_ns];
        let _: () = msg_send![alert, addButtonWithTitle: c_ns];
        let ret: isize = msg_send![alert, runModal];
        let _: () = msg_send![alert, release];
        ret == 1000
    }
}
#[cfg(not(target_os = "macos"))]
fn native_restart_confirm(_app_name: &str) -> bool { true }

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    // Chiude TUTTO: backend + app (usato dal modale Cmd+Q → "Quit App")
    kill_backend();
    SHOULD_EXIT.store(true, Ordering::SeqCst);
    let home = std::env::var("HOME").unwrap_or_default();
    let pid_file = if is_expert_mode() { format!("{}/.quinki-expert-app.pid", home) } else { format!("{}/.quinki-app.pid", home) };
    let _ = std::fs::remove_file(&pid_file);
    app.exit(0);
}

// === FIX (01 set): riuso/ricreazione finestra main dopo chiusura reale (rosso da fs) ===
static LAST_NORMAL_FRAME: std::sync::OnceLock<std::sync::Mutex<Option<(i32, i32, u32, u32)>>> = std::sync::OnceLock::new();
fn record_normal_frame(window: &tauri::Window) {
  if window.is_fullscreen().unwrap_or(false) { return; }
  let g = LAST_NORMAL_FRAME.get_or_init(|| std::sync::Mutex::new(None));
  if let (Ok(p), Ok(sz)) = (window.outer_position(), window.outer_size()) {
    *g.lock().unwrap() = Some((p.x, p.y, sz.width, sz.height));
  }
}
fn fs_frame_marker() -> String {
  let home = std::env::var("HOME").unwrap_or_default();
  if is_expert_mode() { format!("{}/.quinki/.restore-frame-expert", home) } else { format!("{}/.quinki/.restore-frame-main", home) }
}
fn show_or_recreate_main(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.set_focus();
    return;
  }
  // La finestra è stata chiusa DAVVERO (rosso da fullscreen) → RICREO dal config.
  // Il plugin window-state ripristinerebbe la geometria FULLSCREEN/maximized:
  // il marker .restore-frame-* contiene il frame PRE-fullscreen → lo applico io.
  let cfgs = app.config().app.windows.clone();
  for wc in cfgs {
    if wc.label == "main" {
      if let Ok(builder) = tauri::WebviewWindowBuilder::from_config(app, &wc) {
        if let Ok(w) = builder.build() {
          let _ = w.show();
          let _ = w.set_focus();
          if let Ok(txt) = std::fs::read_to_string(fs_frame_marker()) {
            let p: Vec<i64> = txt.split(',').filter_map(|x| x.trim().parse().ok()).collect();
            if p.len() == 4 {
              let _ = w.unmaximize();
              let _ = w.set_position(tauri::PhysicalPosition::new(p[0] as i32, p[1] as i32));
              let _ = w.set_size(tauri::PhysicalSize::new(p[2] as u32, p[3] as u32));
            }
          }
          let _ = std::fs::remove_file(fs_frame_marker());
          if is_expert_mode() {
            let _ = w.eval("if(!window.location.search.includes('expert=1')){window.location.replace('index.html?expert=1&tab=expert');}");
          }
        }
      }
    }
  }
}

#[tauri::command]
fn hide_to_tray(app: tauri::AppHandle) {
    // Chiude SOLO il frontend: la finestra si nasconde, app + sidecar restano attivi
    if let Some(window) = app.get_webview_window("main") {
        use tauri_plugin_window_state::AppHandleExt;
        let _ = window.app_handle().save_window_state(tauri_plugin_window_state::StateFlags::all() & !(tauri_plugin_window_state::StateFlags::FULLSCREEN | tauri_plugin_window_state::StateFlags::MAXIMIZED));
        let _ = window.hide();
    }
}

#[tauri::command]
fn quit_expert_app(app: tauri::AppHandle) {
    // Kill watchdog PRIMA (niente race di riaccensione), poi sidecar
    kill_backend();
    SHOULD_EXIT.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    // Same logic as tray menu restart (kill sincrono)
    kill_backend();
    SHOULD_EXIT.store(true, Ordering::SeqCst);
    // Relaunch app — use nohup + detached process so it survives parent exit
    let _ = std::process::Command::new("sh").arg("-c")
      .arg("nohup sh -c 'sleep 1; open /Applications/Quinki.app' >/dev/null 2>&1 &")
      .spawn();
    // Give the detached process time to start before we exit
    std::thread::sleep(std::time::Duration::from_millis(300));
    app.exit(0);
}

#[tauri::command]
fn enable_autostart(app: tauri::AppHandle) -> Result<(), String> {
    let manager = app.autolaunch();
    manager.enable()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn disable_autostart(app: tauri::AppHandle) -> Result<(), String> {
    let manager = app.autolaunch();
    manager.disable()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    let manager = app.autolaunch();
    manager.is_enabled()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_in_new_window(app: tauri::AppHandle, tab: String, _session: Option<String>) -> Result<String, String> {
    let label = format!("win-{}", tab);
    eprintln!("[open_in_new_window] tab={}, label={}", tab, label);
    
    // Show existing window if it exists
    if let Some(window) = app.get_webview_window(&label) {
        eprintln!("[open_in_new_window] showing existing window");
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(label);
    }
    
    // Create from config
    let config = app.config();
    let win_config = config.app.windows.iter().find(|w| w.label == label);
    
    match win_config {
        Some(wc) => {
            eprintln!("[open_in_new_window] found config, creating from_config");
            let builder = tauri::WebviewWindowBuilder::from_config(&app, wc)
                .map_err(|e| { eprintln!("[open_in_new_window] from_config error: {}", e); e.to_string() })?;
            let window = builder.build()
                .map_err(|e| { eprintln!("[open_in_new_window] build error: {}", e); e.to_string() })?;
            eprintln!("[open_in_new_window] window built, showing");
            let _ = window.show();
            let _ = window.set_focus();
            Ok(label)
        }
        None => {
            eprintln!("[open_in_new_window] no config found for label={}", label);
            // Log all available window labels
            for w in &config.app.windows {
                eprintln!("[open_in_new_window] available: label={}", w.label);
            }
            Err(format!("No window config for: {}", label))
        }
    }
}
#[tauri::command]
fn open_chat_in_window(app: tauri::AppHandle, session_key: String) -> Result<String, String> {
    let label = "win-chat".to_string();
    
    // Show existing window or create from config
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("switch-session", &session_key);
        return Ok(label);
    }
    
    // Create from config
    let config = app.config();
    let win_config = config.app.windows.iter().find(|w| w.label == label);
    
    if let Some(wc) = win_config {
        let builder = tauri::WebviewWindowBuilder::from_config(&app, wc)
            .map_err(|e| e.to_string())?;
        let window = builder.build()
            .map_err(|e| e.to_string())?;
        window.eval(&format!("window.__chatSessionKey = '{}';", session_key.replace("'", "\\'"))).ok();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(label);
    }
    
    Err("No window config for win-chat".to_string())
}

#[tauri::command]
fn focus_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_focus();
        Ok(())
    } else {
        Err("Window not found".to_string())
    }
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
fn close_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    }
    Ok(())
}

#[tauri::command]
fn get_window_label(window: tauri::WebviewWindow) -> String {
    window.label().to_string()
}

// === Quick Chat: shortcut configurabile (31 ago) ===
#[tauri::command]
fn get_quick_chat_shortcut() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    std::fs::read_to_string(format!("{}/.quinki/quick-chat-shortcut.txt", home))
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "Option+Space".to_string())
}

#[tauri::command]
fn suspend_quick_chat_shortcut(app: tauri::AppHandle) -> Result<(), String> {
    // SOSPENDI il global shortcut durante il recording — altrimenti premere
    // Option+Space per registrarlo APRIREBBE anche la Quick Chat (doppio effetto).
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    let current = get_quick_chat_shortcut();
    let _ = gs.unregister(current.as_str());
    Ok(())
}

#[tauri::command]
fn set_quick_chat_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<String, String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    // Deregistra il VECCHIO shortcut
    let old = get_quick_chat_shortcut();
    let _ = gs.unregister(old.as_str());
    // Registra il NUOVO
    match gs.on_shortcut(shortcut.as_str(), move |app, _s, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            quick_chat_open(app);
        }
    }) {
        Ok(_) => {
            // Salva su file
            let home = std::env::var("HOME").unwrap_or_default();
            let _ = std::fs::write(format!("{}/.quinki/quick-chat-shortcut.txt", home), &shortcut);
            Ok(shortcut)
        }
        Err(e) => Err(format!("Failed to register shortcut: {}", e)),
    }
}

// === Quick Chat: finestra per domande al volo (31 ago) — TOP-LEVEL per essere accessibile dai comandi ===
fn quick_chat_open(app: &tauri::AppHandle) {
    // Se la finestra esiste già → focus
    if let Some(win) = app.get_webview_window("win-quick-chat") {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }
    // Altrimenti → crea (stesso stile della finestra main: titlebar overlay,
    // niente titolo visibile, si fonde con lo sfondo dell'app)
    let url = tauri::WebviewUrl::App("index.html".into());
    // Usa WORK_AREA di Tauri: lo spazio disponibile del desktop SENZA Dock e menu bar.
    // Larghezza: come la chat area della finestra principale (~75% schermo, max 950px).
    let (w, h) = {
        let mut w = 950.0f64;
        let mut h = 800.0f64;
        if let Ok(Some(monitor)) = app.primary_monitor() {
            let wa = monitor.work_area();
            let scale = monitor.scale_factor();
            let avail_h = wa.size.height as f64 / scale;
            let avail_w = wa.size.width as f64 / scale;
            h = avail_h; // TUTTA l'altezza disponibile (work_area esclude dock)
            w = (avail_w * 0.85).min(1100.0); // MAX chat area width (85% schermo)
        }
        (w, h)
    };
    match tauri::WebviewWindowBuilder::new(app, "win-quick-chat", url)
        .title("")
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .inner_size(w, h)
        .min_inner_size(700.0, 500.0)
        .center()
        .resizable(true)
        .visible(true)
        .build()
    {
        Ok(win) => {
            // IL WINDOW-STATE PLUGIN GESTISCE LE DIMENSIONI:
            // - Se c'è uno stato salvato (l'utente ha ridimensionato) → RIPRISTINA quello
            // - Se NON c'è (prima volta) → usa il default del builder (work_area, GRANDE)
            // - Il file .window-state.json sopravvive alle reinstall (è in Application Support)
            let _ = win.set_focus();
        }
        Err(e) => { eprintln!("quick-chat-open-error: {}", e); }
    }
}

pub fn run() {
    // === Single instance check ===
    // If the app is already running, focus the existing window and exit
    use std::fs;
    use std::io::Write;
    let pid_file = if is_expert_mode() {
        format!("{}/.quinki-expert-app.pid", std::env::var("HOME").unwrap_or_default())
    } else {
        format!("{}/.quinki-app.pid", std::env::var("HOME").unwrap_or_default())
    };
    if let Ok(existing_pid) = fs::read_to_string(&pid_file) {
        let pid: i32 = existing_pid.trim().parse().unwrap_or(0);
        if pid > 0 {
            // Check if the process is still running
            let running = unsafe { libc::kill(pid, 0) == 0 };
            if running {
                // FIX F12 (02 set): kill(pid,0) dice solo che il PID ESISTE — col riuso dei
                // PID (VM: un "routined" prese il 395) l'app credeva di essere già aperta
                // e usciva IN SILENZIO a ogni avvio, per sempre. Verifichiamo che il processo
                // sia DAVVERO questa app (match sul path del binario nella command line).
                let is_us = std::process::Command::new("ps")
                    .args(["-p", &pid.to_string(), "-o", "command="])
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                    .map(|cmdline| {
                        if is_expert_mode() { cmdline.contains("App Expert.app/Contents/MacOS") }
                        else { cmdline.contains("Quinki.app/Contents/MacOS") && !cmdline.contains("App Expert.app") }
                    })
                    .unwrap_or(false);
                if is_us {
                    // App is already running — exit silently
                    std::process::exit(0);
                } else {
                    // PID stantio (processo morto/riusato) → pulisci e prosegui
                    let _ = fs::remove_file(&pid_file);
                }
            }
        }
    }
    // Write our PID
    let _ = fs::File::create(&pid_file).and_then(|mut f| f.write_all(std::process::id().to_string().as_bytes()));

    // Window-state file must differ per app so main and App Expert keep independent size/position.
    let window_state_filename = if is_expert_mode() {
      ".expert-window-state.json".to_string()
    } else {
      ".window-state.json".to_string()
    };
    let app = tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        set_window_bg_color,
        __drag_window,
        __toggle_maximize,
        export_chat_file,
        pick_directory,
        pick_files,
        pick_profile_image,
        copy_to_attachments,
        save_attachment_content,
        open_attachments_folder,
        open_longhorizon_folder,
        open_general_attachments_folder,
        open_url,
        open_system_settings,
        check_tcc_status,
        read_expert_tcc_status,
        read_quinki_settings,
        get_authorized_folders,
        add_authorized_folder,
        remove_authorized_folder,
        get_app_permissions,
        set_app_permissions,
        get_sidecar_version,
        get_sidecar_versions,
        list_attachments,
        take_screenshot,
        check_expert_installed,
        is_expert_app_running,
        install_expert_app,
        sync_expert_app,
        rollback_expert_app,
        check_expert_backup_exists,
        restart_expert_app,
        check_expert_needs_restart,
        expert_self_restart_now,
        expert_restart_pending,
        check_expert_running,
        open_expert_app,
        install_main_app,
        restart_main_app,
        apply_update,
        quit_expert_app,
        quit_app,
        hide_to_tray,
        restart_app,
        enable_autostart,
        disable_autostart,
        is_autostart_enabled,
        open_in_new_window,
        open_chat_in_window,
        focus_window,
        close_window,
        hide_window,
        get_window_label,
        get_quick_chat_shortcut,
        set_quick_chat_shortcut,
        suspend_quick_chat_shortcut,
        send_notification,
        request_notification_permission,
        request_expert_notification_permission,
        send_expert_test_notification,
    ])
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .plugin(tauri_plugin_window_state::Builder::default()
      .with_state_flags(tauri_plugin_window_state::StateFlags::SIZE | tauri_plugin_window_state::StateFlags::POSITION | tauri_plugin_window_state::StateFlags::DECORATIONS)
      .with_denylist(&["win-usage", "win-usage-ollama"])
      .with_filename(window_state_filename.clone())
      .build())
    .plugin(tauri_plugin_log::Builder::default()
      .level(log::LevelFilter::Info)
      .build())
    
// ============================================================================
// TEST BRIDGE (instrumentazione test VM): JS-injection nella webview MAIN.
// Attivo SOLO se QUINKI_TEST_BRIDGE=1 all'avvio (mai in produzione).
// Protocollo: connecta a 127.0.0.1:9555, manda JS, chiudi — viene eval-ato.
// ============================================================================
.setup(move |app| {
      // === FIX quit macOS: intercetta applicationShouldTerminate (Cmd+Q, dock, menu Apple) ===
      #[cfg(target_os = "macos")]
      {
        terminate_delegate::install(app.handle().clone());
      }

      // TEST BRIDGE: JS-injection nella webview (solo QUINKI_TEST_BRIDGE=1)
      start_test_bridge(app.handle().clone());

      // === A3: richiesta AUTOMATICA del permesso notifiche al primo avvio
      // (macOS chiede una volta sola; l'app compare in System Settings → Notifiche) ===
      {
        #[cfg(target_os = "macos")]
        {
          use objc::{class, msg_send, sel, sel_impl};
          use objc::runtime::Object;
          unsafe {
            let cls = class!(UNUserNotificationCenter);
            let center: *mut Object = msg_send![cls, currentNotificationCenter];
            let options: u64 = 1 | 2 | 4;
            let block = block::ConcreteBlock::new(move |granted: bool, _error: *mut Object| { let _ = granted; });
            let block = block.copy();
            let block_ptr: *mut std::ffi::c_void = &*block as *const _ as *mut std::ffi::c_void;
            let _: () = msg_send![center, requestAuthorizationWithOptions: options completionHandler: block_ptr];
            // Delegate per mostrare le notifiche ANCHE in primo piano
            setup_notification_delegate(app.handle());
          }
        }
      }

      // === A3: polling del flag file — quando la main scrive .expert-request-notif-perm,
      // richiedi il permesso notifiche (funziona anche se l'Expert è già in esecuzione) ===
      {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        let flag = format!("{}/.quinki/.expert-request-notif-perm", home);
        let flag_test = format!("{}/.quinki/.expert-test-notif", home);
        std::thread::spawn(move || {
          loop {
            std::thread::sleep(std::time::Duration::from_secs(3));
            if !std::path::Path::new(&flag).exists() && !std::path::Path::new(&flag_test).exists() { continue; }
            if std::path::Path::new(&flag).exists() {
              let _ = std::fs::remove_file(&flag);
              #[cfg(target_os = "macos")]
              {
                use objc::{class, msg_send, sel, sel_impl};
                use objc::runtime::Object;
                unsafe {
                  let cls = class!(UNUserNotificationCenter);
                  let center: *mut Object = msg_send![cls, currentNotificationCenter];
                  let options: u64 = 1 | 2 | 4;
                  let block = block::ConcreteBlock::new(move |granted: bool, _error: *mut Object| { let _ = granted; });
                  let block = block.copy();
                  let block_ptr: *mut std::ffi::c_void = &*block as *const _ as *mut std::ffi::c_void;
                  let _: () = msg_send![center, requestAuthorizationWithOptions: options completionHandler: block_ptr];
                }
              }
            }
            if std::path::Path::new(&flag_test).exists() {
              let _ = std::fs::remove_file(&flag_test);
              send_macos_notification("App Expert", "Test notification — if you see this, App Expert notifications work!", "");
            }
          }
        });
      }
      // === Window state: restore sub-windows that were open ===
      // With create:false, sub-windows are NOT created at startup.
      // We need to create them if they were visible in the saved state.
      // The window-state plugin will then restore their position/size.
      {
        use std::collections::HashMap;
        let app_dir = app.path().app_config_dir().unwrap_or_default();
        let state_file = app_dir.join(&window_state_filename);
        let saved: HashMap<String, serde_json::Value> = if state_file.exists() {
          std::fs::read_to_string(&state_file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
        } else {
          HashMap::new()
        };
        
        // For each window in config that is NOT main and NOT already created:
        // create it if it was visible in saved state
        let config = app.config();
        for wc in &config.app.windows {
          if wc.label == "main" { continue; }
          // Skip if window already exists (created at startup)
          if app.get_webview_window(&wc.label).is_some() { 
            // Window exists — hide if it shouldn't be visible
            let should_show = saved.get(&wc.label)
              .and_then(|v| v.get("visible"))
              .and_then(|v| v.as_bool())
              .unwrap_or(false);
            if !should_show {
              if let Some(w) = app.get_webview_window(&wc.label) {
                let _ = w.hide();
              }
            }
            continue;
          }
          // Window doesn't exist (create:false) — create if it was visible
          let should_show = saved.get(&wc.label)
            .and_then(|v| v.get("visible"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
          if should_show {
            let handle = app.handle();
            if let Ok(builder) = tauri::WebviewWindowBuilder::from_config(handle, wc) {
              if let Ok(window) = builder.build() {
                let _ = window.show();
                let _ = window.set_focus();
              }
            }
          }
        }
      }

      #[cfg(target_os = "macos")]
      {
        let window = app.get_webview_window("main").unwrap();
        eprintln!("[QUINKI] Setting NSWindow background color to #08080b");
        use objc::runtime::Object; type id = *mut Object;
        use objc::{msg_send, sel, sel_impl};
        let ns_window = window.ns_window().unwrap() as id;
        unsafe {
          let ns_color_cls = objc::class!(NSColor);
          let bg: id = msg_send![ns_color_cls, colorWithDeviceRed: 0.031f64 green: 0.031f64 blue: 0.043f64 alpha: 1.0f64];
          let _: () = msg_send![ns_window, setBackgroundColor: bg];
        }
      }

      // === Expert mode: redirect main window to expert URL ===
      if is_expert_mode() {
        // Registra il build che l'Expert sta eseguendo (per il confronto badge)
        record_running_build();
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.eval("if(!window.location.search.includes('expert=1')){window.location.replace('index.html?expert=1&tab=expert');}");
        }
      }
      // === FIX (01 set): ripristino fullscreen dopo Cmd+Q (marker file, non plugin) ===
      {
        let home = std::env::var("HOME").unwrap_or_default();
        let marker = if is_expert_mode() { format!("{}/.quinki/.restore-fs-expert", home) } else { format!("{}/.quinki/.restore-fs-main", home) };
        if std::path::Path::new(&marker).exists() {
          if let Some(w) = app.get_webview_window("main") {
            let _ = w.set_fullscreen(true);
          }
          let _ = std::fs::remove_file(&marker);
        }
      }

// === Quick Chat (31 ago): finestra piccola per domande al volo ===
// Apre da: tasto sinistro sull'icona try + shortcut globale (⌥+Spazio default)
// La finestra mostra la welcome chat; quando l'utente manda un messaggio,
// la sessione viene creata e la chat continua NELLA FINESTRA.

// Registra lo shortcut globale per Quick Chat (default: Option+Space)
fn quick_chat_register_shortcut(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    // Leggi lo shortcut salvato (default: Option+Space = alt+Space)
    let shortcut_str = std::fs::read_to_string(format!("{}/.quinki/quick-chat-shortcut.txt", std::env::var("HOME").unwrap_or_default()))
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "Option+Space".to_string());
    let _ = gs.on_shortcut(shortcut_str.as_str(), move |app, _shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            quick_chat_open(app);
        }
    });
}

      // === Tray icon (main app only — Expert app has no tray) ===
      if !is_expert_mode() {
      let show_item = MenuItem::with_id(app, "show", "Show Quinki", true, None::<&str>)?;
      let reload_item = MenuItem::with_id(app, "reload_quinki", "Reload Quinki", true, None::<&str>)?;
      let restart_item = MenuItem::with_id(app, "restart", "Restart Quinki", true, None::<&str>)?;
      let quit_item = MenuItem::with_id(app, "quit", "Quit Quinki", true, None::<&str>)?;
      let tray_sep = PredefinedMenuItem::separator(app)?;
      let menu = Menu::with_items(app, &[&show_item, &reload_item, &restart_item, &tray_sep, &quit_item])?;

      let tray_img = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
          .unwrap_or_else(|_| app.default_window_icon().unwrap().clone());

      let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .icon(tray_img)
        .icon_as_template(false)
        .menu_on_left_click(false)
        .tooltip("Quinki")
        .on_menu_event(|app, event| {
          match event.id.as_ref() {
            "show" => {
              show_or_recreate_main(app);
            }
            "reload_quinki" => {
              // Reload del WEBVIEW (tutta l'app frontend, non solo la chat)
              if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.location.reload()");
              }
            }
            "restart" => {
              // FIX: conferma nativa come il quit — il restart involontario va evitato
              if !native_restart_confirm("Quinki") { return; }
              // Kill sidecar (sincrono) poi riapri
              kill_backend();
              SHOULD_EXIT.store(true, Ordering::SeqCst);
              // Relaunch app — use nohup + detached process so it survives parent exit
              let _ = std::process::Command::new("sh").arg("-c")
                .arg("nohup sh -c 'sleep 1; open /Applications/Quinki.app' >/dev/null 2>&1 &")
                .spawn();
              // Give the detached process time to start before we exit
              std::thread::sleep(std::time::Duration::from_millis(300));
              app.exit(0);
            }
            "quit" => {
              // Il quit dal tray chiude TUTTO (app + backend) → conferma nativa macOS
              if native_quit_confirm("Quinki") {
                kill_backend();
                SHOULD_EXIT.store(true, Ordering::SeqCst);
                app.exit(0);
              }
            }
            _ => {}
          }
        })
        .on_tray_icon_event(|tray, event| {
          // LEFT CLICK → apre la Quick Chat (feature 31 ago)
          // RIGHT CLICK → menu (gestito da menu_on_left_click = false)
          if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
            let app = tray.app_handle().clone();
            quick_chat_open(&app);
          }
        })
        .build(app)?;
      } // end if !is_expert_mode()

      // === Quick Chat: registra lo shortcut globale (default ⌥+Spazio) ===
      // Deve essere DOPO il plugin registration per funzionare.
      if !is_expert_mode() {
        let app_handle = app.handle().clone();
        std::thread::spawn(move || {
          std::thread::sleep(std::time::Duration::from_millis(2000));
          quick_chat_register_shortcut(&app_handle);
        });
      }

      // === Menu applicazione: originale (About/Hide/Quit + Edit + Window) con
      // Check for Update come ultima voce ===
      {
        let app_name = if is_expert_mode() { "App Expert" } else { "Quinki" };
        let about = PredefinedMenuItem::about(app, Some(app_name), None)?;
        let sep = PredefinedMenuItem::separator(app)?;
        let hide = PredefinedMenuItem::hide(app, None)?;
        let quit_noaccel = MenuItem::with_id(app, "app-quit", format!("Quit {}", app_name), true, None::<&str>)?;
        let check_item = MenuItem::with_id(app, "app-check-update", "Check for Update…", true, None::<&str>)?;
        let app_sub = Submenu::with_items(app, app_name, true, &[&about, &sep, &hide, &sep, &quit_noaccel, &check_item])?;

        let undo = PredefinedMenuItem::undo(app, None)?;
        let redo = PredefinedMenuItem::redo(app, None)?;
        let cut = PredefinedMenuItem::cut(app, None)?;
        let copy = PredefinedMenuItem::copy(app, None)?;
        let paste = PredefinedMenuItem::paste(app, None)?;
        let select_all = PredefinedMenuItem::select_all(app, None)?;
        let edit_sub = Submenu::with_items(app, "Edit", true, &[&undo, &redo, &sep, &cut, &copy, &paste, &select_all])?;

        let min = PredefinedMenuItem::minimize(app, None)?;
        let close_win = PredefinedMenuItem::close_window(app, None)?;
        let window_sub = Submenu::with_items(app, "Window", true, &[&min, &close_win])?;

        let menu = Menu::with_items(app, &[&app_sub, &edit_sub, &window_sub])?;
        let _ = app.set_menu(menu.clone());
        app.on_menu_event(move |app, event| {
          if event.id() == "app-check-update" {
            check_for_update_dialog(app.clone());
          }
        });
      }

      // === Sidecar start ===
      #[cfg(not(target_os = "windows"))]
      {
        use tauri_plugin_shell::ShellExt;
        
        let sidecar_dir = app.path().resource_dir().unwrap().join("resources").join("sidecar").to_string_lossy().to_string();
        
        if is_expert_mode() {
          // Expert mode: start expert sidecar on port 9183 + watchdog
          let start_script = format!("{}/start-expert.sh", sidecar_dir);
          let watchdog_script = format!("{}/expert-watchdog.sh", sidecar_dir);
          let _ = app.shell().command("sh")
            .args(["-c", &format!("nohup bash '{}' >/dev/null 2>&1 &", start_script)])
            .spawn();
          // Start watchdog with nohup so it survives app exit
          let _ = app.shell().command("sh")
            .args(["-c", &format!("nohup bash '{}' >/dev/null 2>&1 &", watchdog_script)])
            .spawn();
          log::info!("Expert sidecar + watchdog launched (port 9183)");
        } else {
          // Normal mode: start main sidecar on port 9182
          let start_script = format!("{}/start.sh", sidecar_dir);
          let cmd = app.shell().command("sh")
            .args(["-c", &format!("bash '{}' &", start_script)]);
          match cmd.spawn() {
            Ok((mut rx, _child)) => {
              log::info!("Sidecar start script launched");
              std::thread::spawn(move || {
                while let Some(_event) = rx.blocking_recv() {}
              });
            }
            Err(e) => {
              log::error!("Failed to start sidecar: {}", e);
            }
          }
          // FIX F10 (02 set): watchdog per il sidecar MAIN (porta 9182) — prima un crash
          // lasciava l'app morta sullo splash "Could not start!" per sempre. Come l'Expert.
          let main_watchdog = format!("{}/main-watchdog.sh", sidecar_dir);
          let _ = app.shell().command("sh")
            .args(["-c", &format!("nohup bash '{}' >/dev/null 2>&1 &", main_watchdog)])
            .spawn();
          log::info!("Main sidecar watchdog launched");
        }
      }

      // === A3: polling notifiche — quando la finestra è nascosta, mostra i pop-up nativi ===
      {
        use tauri_plugin_notification::NotificationExt;
        let app_handle = app.handle().clone();
        std::thread::spawn(move || {
          let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
          let notif_file = format!("{}/.quinki/notifications.jsonl", home);
          let read_state_file = format!("{}/.quinki/read-state.json", home);
          let mut last_size: u64 = 0;
          if let Ok(md) = std::fs::metadata(&notif_file) { last_size = md.len(); }
          loop {
            std::thread::sleep(std::time::Duration::from_secs(5));
            // Solo se la finestra principale è nascosta (il frontend gestisce i pop-up quando è visibile)
            let window_visible = app_handle.get_webview_window("main").map(|w| w.is_visible().unwrap_or(false)).unwrap_or(false);
            if window_visible { 
              if let Ok(md) = std::fs::metadata(&notif_file) { last_size = md.len(); }
              continue; 
            }
            let Ok(md) = std::fs::metadata(&notif_file) else { continue };
            if md.len() <= last_size { continue; }
            let Ok(content) = std::fs::read_to_string(&notif_file) else { continue };
            let lines: Vec<&str> = content.lines().collect();
            let total = lines.len() as u64;
            let start = last_size;
            last_size = md.len();
            // Leggi le nuove righe (dall'ultima dimensione nota)
            let mut new_entries: Vec<serde_json::Value> = Vec::new();
            let mut acc: String = String::new();
            let mut acc_len: u64 = 0;
            for line in lines {
              acc_len += line.len() as u64 + 1;
              if acc_len <= start { continue; }
              if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) { new_entries.push(v); }
            }
            let _ = total;
            // read-state per il filtro notifyMode
            let read_state: serde_json::Value = std::fs::read_to_string(&read_state_file)
              .ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(serde_json::json!({}));
            for entry in new_entries {
              let kind = entry.get("kind").and_then(|k| k.as_str()).unwrap_or("");
              if kind != "task_complete" { continue; }
              // Filtro notifyMode: la chat sorgente deve avere all o tasks-only
              let src_key = entry.get("sourceSession").and_then(|s| s.get("key")).and_then(|k| k.as_str()).unwrap_or("");
              let mode = read_state.get(src_key).and_then(|s| s.get("notifyMode")).and_then(|m| m.as_str()).unwrap_or("none");
              if mode != "all" && mode != "tasks-only" { continue; }
              let title = entry.get("label").and_then(|l| l.as_str()).unwrap_or("Task completed");
              let body = format!("Task completed: {}", title);
              let _ = app_handle.notification().builder().title("Quinki").body(&body).show();
            }
          }
        });
      }
      
      Ok(())
    })
    .on_menu_event(|app, event| {
      // Item "Quit" del menu applicazione (senza Cmd+Q) → stesso modale di Cmd+Q
      if event.id.as_ref() == "app-quit" {
        let _ = app.emit("quit_requested", ());
      }
    })
    .on_window_event(|window, event| {
      // FIX (01 set): in fullscreen il tasto GIALLO (minimize) va disabilitato (comportamento macOS)
      if let WindowEvent::Resized(..) = event {
        let fs = window.is_fullscreen().unwrap_or(false);
        let _ = window.set_minimizable(!fs);
        if !fs { record_normal_frame(window); }
      }
      if let WindowEvent::Moved(..) = event {
        if !window.is_fullscreen().unwrap_or(false) { record_normal_frame(window); }
      }
      // Close-to-tray: ONLY main window hides. Sub-windows close normally.
      if let WindowEvent::CloseRequested { api, .. } = event {
        // Cmd+Q / quit vero: salva TUTTO (fullscreen compreso) — alla prossima apertura
        // la finestra riparte com'era. Il rosso invece non salva mai il fullscreen.
        if SHOULD_EXIT.load(Ordering::SeqCst) {
          // Cmd+Q/quit in fullscreen → MARKER FILE: alla prossima apertura il fullscreen
          // lo ripristino IO (il plugin window-state lo cancella col suo save d'uscita).
          if window.is_fullscreen().unwrap_or(false) {
            let home = std::env::var("HOME").unwrap_or_default();
            let marker = if is_expert_mode() { format!("{}/.quinki/.restore-fs-expert", home) } else { format!("{}/.quinki/.restore-fs-main", home) };
            let _ = std::fs::write(&marker, "1");
          }
          use tauri_plugin_window_state::AppHandleExt;
          let _ = window.app_handle().save_window_state(tauri_plugin_window_state::StateFlags::all());
        }
        if is_expert_mode() {
          // Expert app: close-to-tray (hide, don't quit) — save window state first
          if window.label() == "main" && !SHOULD_EXIT.load(Ordering::SeqCst) {
            use tauri_plugin_window_state::AppHandleExt;
            let _ = window.app_handle().save_window_state(tauri_plugin_window_state::StateFlags::all() & !(tauri_plugin_window_state::StateFlags::FULLSCREEN | tauri_plugin_window_state::StateFlags::MAXIMIZED));
            // FIX (01 set v2): la finestra CHIUDE subito (hide istantaneo). Il flag
            // fullscreen si pulisce DOPO, a finestra gia nascosta: niente animazione
            // visibile, niente schermo nero appeso, desktop subito raggiungibile.
            if window.is_fullscreen().unwrap_or(false) {
              // FIX (01 set v4 — decisione utente): rosso da fullscreen = TOGLI SOLO il
              // fullscreen (animazione nativa) e NON chiude/nasconde la finestra.
              // Ogni hide post-animazione lottava con la transizione di macOS
              // (orderOut annullato e ri-mostrato a fine animazione → "si chiude
              // più volte"). La finestra resta aperta e VIVA.
              let _ = window.set_fullscreen(false);
              api.prevent_close();
            } else {
              let _ = window.hide();
              api.prevent_close();
            }
          }
        } else if window.label() == "main" && !SHOULD_EXIT.load(Ordering::SeqCst) {
          // Main app: close-to-tray (hide, don't quit) — save window state first
          use tauri_plugin_window_state::AppHandleExt;
          let _ = window.app_handle().save_window_state(tauri_plugin_window_state::StateFlags::all() & !(tauri_plugin_window_state::StateFlags::FULLSCREEN | tauri_plugin_window_state::StateFlags::MAXIMIZED));
          // FIX (01 set v2): hide prima, pulizia fullscreen dopo (a finestra nascosta)
          if window.is_fullscreen().unwrap_or(false) {
            // FIX (01 set v4): vedi branch expert — rosso da fullscreen = SOLO uscita dal fullscreen
            let _ = window.set_fullscreen(false);
            api.prevent_close();
          } else {
            let _ = window.hide();
            api.prevent_close();
          }
        } else if window.label() != "main" {
          // Sub-window: chiudi normalmente. Quando la finestra in primo piano
          // si chiude, macOS porta le altre finestre dell'app in avanti (comportamento
          // NATIVO di macOS — stesso per TextEdit, Finder, Chrome). Non è un bug
          // dell'app, è il design di macOS per mantenere focus sull'app attiva.
          let _ = window.hide();
          use tauri_plugin_window_state::AppHandleExt;
          let _ = window.app_handle().save_window_state(tauri_plugin_window_state::StateFlags::all() & !(tauri_plugin_window_state::StateFlags::FULLSCREEN | tauri_plugin_window_state::StateFlags::MAXIMIZED));
        }
      }
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

    app.run(|_app_handle, event| {
      // Dock click → show window (Reopen event)
      if let tauri::RunEvent::Reopen { .. } = event {
        // FIX (01 set): finestra chiusa davvero (rosso da fullscreen) → ricreazione
        show_or_recreate_main(_app_handle);
      }
      // Prevent exit only if not explicitly requested
      if let tauri::RunEvent::ExitRequested { api, .. } = event {
        if !SHOULD_EXIT.load(Ordering::SeqCst) {
          // Cmd+Q, quit dal menu macOS O dal dock: NON uscire, chiedi all'utente.
          // FIX: se la finestra era nascosta (close-to-tray), il modale si apriva
          // nella finestra invisibile → l'utente non vedeva la conferma.
          api.prevent_exit();
          if let Some(window) = _app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
          }
          let _ = _app_handle.emit("quit_requested", ());
        } else {
          // SHOULD_EXIT (tray quit confermato / modale "Quit App") → kill backend PRIMA di uscire
          kill_backend();
          let pid_file = if is_expert_mode() {
        format!("{}/.quinki-expert-app.pid", std::env::var("HOME").unwrap_or_default())
    } else {
        format!("{}/.quinki-app.pid", std::env::var("HOME").unwrap_or_default())
    };
          let _ = std::fs::remove_file(&pid_file);
        }
      }
    });
}