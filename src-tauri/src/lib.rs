use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent, Emitter,
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;

static SHOULD_EXIT: AtomicBool = AtomicBool::new(false);

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
fn send_notification(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    // Richiedi il permesso al primo invio (macOS mostra il prompt; l'app compare in System Settings)
    let _ = app.notification().request_permission();
    let _ = app.notification().builder()
        .title(&title)
        .body(&body)
        .show();
    Ok(())
}

#[tauri::command]
fn request_notification_permission(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    // Il plugin tauri-plugin-notification ha request_permission() come STUB su macOS
    // (restituisce Granted senza fare nulla) → l'app non compare mai in System Settings.
    // Implementiamo la richiesta REALE con UNUserNotificationCenter.
    #[cfg(target_os = "macos")]
    {
        use objc::{class, msg_send, sel, sel_impl};
        use objc::runtime::Object;
        unsafe {
            let cls = class!(UNUserNotificationCenter);
            let center: *mut Object = msg_send![cls, currentNotificationCenter];
            // UNAuthorizationOptionAlert=1, Sound=2, Badge=4
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
    
    // Copy expert icon if available
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let expert_icon = format!("{}/Projects/Quinki/src-tauri/icons/expert-icon.icns", home);
    if std::path::Path::new(&expert_icon).exists() {
        let _ = std::fs::copy(&expert_icon, format!("{}/Contents/Resources/icon.icns", expert_app));
        let _ = std::process::Command::new("/usr/libexec/PlistBuddy")
            .args(["-c", "Set :CFBundleIconFile icon", &plist])
            .output();
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

    // Scrive il flag SOLO dopo la verifica: l'App Expert mostrerà il badge di riavvio
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let flag = format!("{}/.quinki/.expert-needs-restart", home);
    std::fs::write(&flag, "1").map_err(|e| format!("Flag write failed: {}", e))?;
    
    Ok("Expert app synced and verified. Restart App Expert to apply.".to_string())
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
fn restart_expert_app() -> Result<(), String> {
    // Spawn UN SINGOLO script distaccato che fa l'INTERO restart dell'EXPERT:
    //   sleep 2 → kill sidecar 9183 → kill app Expert → attendi porta libera → reopen.
    // Il processo `sh` diventa orfano quando l'Expert muore, ma CONTINUA e completa
    // tutto. NON tocca MAI la main (il pattern uccide solo App Expert.app).
    let script = "sleep 2; lsof -ti:9183 | xargs kill -9 2>/dev/null; pkill -f 'App Expert.app/Contents/MacOS/quinki' 2>/dev/null; for i in 1 2 3 4 5 6 7 8; do if ! lsof -ti:9183 >/dev/null 2>&1; then break; fi; sleep 1; done; open '/Applications/App Expert.app'";
    let _ = std::process::Command::new("sh")
        .arg("-c")
        .arg(script)
        .spawn();

    // Remove the flag file
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let flag = format!("{}/.quinki/.expert-needs-restart", home);
    let _ = std::fs::remove_file(&flag);

    Ok(())
}

#[tauri::command]
fn check_expert_needs_restart() -> Result<bool, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let stored_path = format!("{}/.quinki/.expert-running-build.json", home);

    // Leggi l'MD5 del build che l'Expert stava eseguendo all'ultimo avvio
    let stored = std::fs::read_to_string(&stored_path).ok();
    let stored = stored.map(|t| {
        let b = t.split("\"binary\":\"").nth(1).and_then(|r| r.split('"').next()).map(String::from);
        let s = t.split("\"sidecar\":\"").nth(1).and_then(|r| r.split('"').next()).map(String::from);
        (b, s)
    });

    let Some((Some(sb), Some(ss))) = stored else {
        // Mai registrato: registra ora e non mostrare badge (evita falsi positivi al primo avvio)
        record_running_build();
        return Ok(false);
    };

    // Confronta con il build ATTUALE dell'Expert (non della main): se differisce
    // da quello registrato all'avvio, l'Expert è stato sincronizzato ma non riavviato → badge.
    // (Confrontare con la main era sbagliato: le firme diverse cambiano l'MD5 del binario.)
    let Some((eb, es)) = app_build_fingerprint("/Applications/App Expert.app") else {
        return Ok(false);
    };
    Ok(eb != sb || es != ss)
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
fn quit_expert_app(app: tauri::AppHandle) {
    // Kill expert sidecar + watchdog
    let _ = std::process::Command::new("sh").arg("-c")
      .arg("lsof -ti:9183 | xargs kill -9 2>/dev/null; pkill -f 'start-expert.sh' 2>/dev/null; pkill -f expert-watchdog 2>/dev/null")
      .spawn();
    SHOULD_EXIT.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    // Same logic as tray menu restart
    let _ = std::process::Command::new("sh").arg("-c")
      .arg("lsof -ti:9182 | xargs kill -9 2>/dev/null")
      .spawn();
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
                // App is already running — exit silently
                std::process::exit(0);
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
        copy_to_attachments,
        save_attachment_content,
        open_attachments_folder,
        open_longhorizon_folder,
        open_general_attachments_folder,
        open_url,
        open_system_settings,
        check_tcc_status,
        read_expert_tcc_status,
        get_authorized_folders,
        add_authorized_folder,
        remove_authorized_folder,
        get_app_permissions,
        set_app_permissions,
        get_sidecar_version,
        list_attachments,
        check_expert_installed,
        install_expert_app,
        sync_expert_app,
        rollback_expert_app,
        check_expert_backup_exists,
        restart_expert_app,
        check_expert_needs_restart,
        check_expert_running,
        open_expert_app,
        install_main_app,
        restart_main_app,
        apply_update,
        quit_expert_app,
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
        send_notification,
        request_notification_permission,
        request_expert_notification_permission,
    ])
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_window_state::Builder::default()
      .with_state_flags(tauri_plugin_window_state::StateFlags::all())
      .with_filename(window_state_filename.clone())
      .build())
    .plugin(tauri_plugin_log::Builder::default()
      .level(log::LevelFilter::Info)
      .build())
    .setup(move |app| {
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
          }
        }
      }

      // === A3: polling del flag file — quando la main scrive .expert-request-notif-perm,
      // richiedi il permesso notifiche (funziona anche se l'Expert è già in esecuzione) ===
      {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        let flag = format!("{}/.quinki/.expert-request-notif-perm", home);
        std::thread::spawn(move || {
          loop {
            std::thread::sleep(std::time::Duration::from_secs(3));
            if !std::path::Path::new(&flag).exists() { continue; }
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

      // === Tray icon (main app only — Expert app has no tray) ===
      if !is_expert_mode() {
      let show_item = MenuItem::with_id(app, "show", "Show Quinki", true, None::<&str>)?;
      let restart_item = MenuItem::with_id(app, "restart", "Restart Quinki", true, None::<&str>)?;
      let quit_item = MenuItem::with_id(app, "quit", "Quit Quinki", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show_item, &restart_item, &quit_item])?;

      let tray_img = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
          .unwrap_or_else(|_| app.default_window_icon().unwrap().clone());

      let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .icon(tray_img)
        .icon_as_template(false)
        .menu_on_left_click(true)
        .tooltip("Quinki")
        .on_menu_event(|app, event| {
          match event.id.as_ref() {
            "show" => {
              if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
              }
            }
            "restart" => {
              // Kill sidecar processes
              let _ = std::process::Command::new("sh").arg("-c")
                .arg("lsof -ti:9182 | xargs kill -9 2>/dev/null")
                .spawn();
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
              // Kill sidecar processes
              let _ = std::process::Command::new("sh").arg("-c")
                .arg("lsof -ti:9182 | xargs kill -9 2>/dev/null")
                .spawn();
              SHOULD_EXIT.store(true, Ordering::SeqCst);
              app.exit(0);
            }
            _ => {}
          }
        })
        .on_tray_icon_event(|_tray, _event| {
          // Don't show window on click — only menu (menu_on_left_click handles it)
          })
        .build(app)?;
      } // end if !is_expert_mode()

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
    .on_window_event(|window, event| {
      // Close-to-tray: ONLY main window hides. Sub-windows close normally.
      if let WindowEvent::CloseRequested { api, .. } = event {
        if is_expert_mode() {
          // Expert app: close-to-tray (hide, don't quit) — save window state first
          if window.label() == "main" && !SHOULD_EXIT.load(Ordering::SeqCst) {
            use tauri_plugin_window_state::AppHandleExt;
            let _ = window.app_handle().save_window_state(tauri_plugin_window_state::StateFlags::all());
            let _ = window.hide();
            api.prevent_close();
          }
        } else if window.label() == "main" && !SHOULD_EXIT.load(Ordering::SeqCst) {
          // Main app: close-to-tray (hide, don't quit) — save window state first
          use tauri_plugin_window_state::AppHandleExt;
          let _ = window.app_handle().save_window_state(tauri_plugin_window_state::StateFlags::all());
          let _ = window.hide();
          api.prevent_close();
        } else if window.label() != "main" {
          // Sub-window: hide FIRST, then save state (saves visible: false)
          let _ = window.hide();
          use tauri_plugin_window_state::AppHandleExt;
          let _ = window.app_handle().save_window_state(tauri_plugin_window_state::StateFlags::all());
          // Let the window close normally (no prevent_close)
        }
      }
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

    app.run(|_app_handle, event| {
      // Dock click → show window (Reopen event)
      if let tauri::RunEvent::Reopen { .. } = event {
        if let Some(window) = _app_handle.get_webview_window("main") {
          let _ = window.show();
          let _ = window.set_focus();
        }
      }
      // Prevent exit only if not explicitly requested
      if let tauri::RunEvent::ExitRequested { api, .. } = event {
        if !SHOULD_EXIT.load(Ordering::SeqCst) {
          api.prevent_exit();
        } else {
          // SHOULD_EXIT (tray restart) → kill sidecar PRIMA di uscire
          let port = if is_expert_mode() { "9183" } else { "9182" };
          let _ = std::process::Command::new("sh").arg("-c")
            .arg(format!("lsof -ti:{} | xargs kill -9 2>/dev/null", port))
            .spawn();
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