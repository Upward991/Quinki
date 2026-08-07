use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent, Emitter,
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;

static SHOULD_EXIT: AtomicBool = AtomicBool::new(false);

// Detect if running as Quinki Expert (separate app)
fn is_expert_mode() -> bool {
    // Check if the executable path contains "Quinki Expert"
    if let Ok(exe) = std::env::current_exe() {
        if exe.to_string_lossy().contains("Quinki Expert") {
            return true;
        }
    }
    // Also check for --expert arg
    if std::env::args().any(|a| a == "--expert") {
        return true;
    }
    false
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
fn open_expert_app() -> Result<(), String> {
    // Find the Expert app inside the main app bundle
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let main_dir = exe.parent().ok_or("No parent dir")?;
    // main_dir = Quinki.app/Contents/MacOS
    // We need: Quinki.app/Contents/Resources/Quinki Expert.app
    let resources_dir = main_dir.parent().ok_or("No parent")?.join("Resources");
    let expert_app = resources_dir.join("Quinki Expert.app");
    
    if expert_app.exists() {
        std::process::Command::new("open")
            .arg(&expert_app)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Quinki Expert.app not found in bundle".to_string())
    }
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
fn restart_app(app: tauri::AppHandle) {
    // Same logic as tray menu restart
    let _ = std::process::Command::new("sh").arg("-c")
      .arg("pkill -f ws-bridge 2>/dev/null; pkill -f sidecar.ts 2>/dev/null; lsof -ti:9182 | xargs kill -9 2>/dev/null")
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
        open_general_attachments_folder,
        list_attachments,
        open_expert_app,
        sync_from_main,
        sync_from_expert,
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
    ])
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_log::Builder::default()
      .level(log::LevelFilter::Info)
      .build())
    .setup(|app| {
      // === Window state: restore sub-windows that were open ===
      // With create:false, sub-windows are NOT created at startup.
      // We need to create them if they were visible in the saved state.
      // The window-state plugin will then restore their position/size.
      {
        use std::collections::HashMap;
        let app_dir = app.path().app_data_dir().unwrap_or_default();
        let state_file = app_dir.join(".window-state.json");
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
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.eval("if(!window.location.search.includes('expert=1')){window.location.replace('index.html?expert=1&tab=expert');}");
        }
      }

      // === Tray icon ===
      if is_expert_mode() {
        // Expert app: own tray icon (expert icon) with Expert-specific menu
        let show_item = MenuItem::with_id(app, "show", "Show Quinki Expert", true, None::<&str>)?;
        let sync_import = MenuItem::with_id(app, "sync_import", "Import from Main App", true, None::<&str>)?;
        let sync_export = MenuItem::with_id(app, "sync_export", "Export to Main App", true, None::<&str>)?;
        let quit_item = MenuItem::with_id(app, "quit", "Quit Quinki Expert", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show_item, &sync_import, &sync_export, &quit_item])?;

        let tray_img = tauri::image::Image::from_bytes(include_bytes!("../icons/expert-tray-icon.png"))
            .unwrap_or_else(|_| app.default_window_icon().unwrap().clone());

        let _tray = TrayIconBuilder::new()
          .menu(&menu)
          .icon(tray_img)
          .icon_as_template(false)
          .menu_on_left_click(true)
          .tooltip("Quinki Expert")
          .on_menu_event(|app, event| {
            match event.id.as_ref() {
              "show" => {
                if let Some(window) = app.get_webview_window("main") {
                  let _ = window.show();
                  let _ = window.set_focus();
                }
              }
              "sync_import" => {
                let home = std::env::var("HOME").unwrap_or_default();
                let main_dir = format!("{}/.quinki", home);
                let expert_dir = format!("{}/.quinki-expert", home);
                if std::path::Path::new(&format!("{}/agents", main_dir)).exists() {
                    let _ = std::fs::remove_dir_all(format!("{}/agents", expert_dir));
                    let _ = copy_dir_recursive(&format!("{}/agents", main_dir), &format!("{}/agents", expert_dir));
                }
                if std::path::Path::new(&format!("{}/skills", main_dir)).exists() {
                    let _ = std::fs::remove_dir_all(format!("{}/skills", expert_dir));
                    let _ = copy_dir_recursive(&format!("{}/skills", main_dir), &format!("{}/skills", expert_dir));
                }
                if let Some(window) = app.get_webview_window("main") {
                  let _ = window.show();
                  let _ = window.set_focus();
                }
              }
              "sync_export" => {
                let home = std::env::var("HOME").unwrap_or_default();
                let main_dir = format!("{}/.quinki", home);
                let expert_dir = format!("{}/.quinki-expert", home);
                if std::path::Path::new(&format!("{}/agents", expert_dir)).exists() {
                    let _ = std::fs::remove_dir_all(format!("{}/agents", main_dir));
                    let _ = copy_dir_recursive(&format!("{}/agents", expert_dir), &format!("{}/agents", main_dir));
                }
                if std::path::Path::new(&format!("{}/skills", expert_dir)).exists() {
                    let _ = std::fs::remove_dir_all(format!("{}/skills", main_dir));
                    let _ = copy_dir_recursive(&format!("{}/skills", expert_dir), &format!("{}/skills", main_dir));
                }
                if let Some(window) = app.get_webview_window("main") {
                  let _ = window.show();
                  let _ = window.set_focus();
                }
              }
              "quit" => {
                // Kill expert sidecar + watchdog
                let _ = std::process::Command::new("sh").arg("-c")
                  .arg("pkill -f 'start-expert.sh' 2>/dev/null; pkill -f expert-watchdog 2>/dev/null; lsof -ti:9183 | xargs kill -9 2>/dev/null")
                  .spawn();
                SHOULD_EXIT.store(true, Ordering::SeqCst);
                app.exit(0);
              }
              _ => {}
            }
          })
          .on_tray_icon_event(|_tray, _event| {})
          .build(app)?;
      } else {
        // Main app: normal tray icon
      let show_item = MenuItem::with_id(app, "show", "Show Quinki", true, None::<&str>)?;
      let expert_item = MenuItem::with_id(app, "expert", "Open Quinki Expert App", true, None::<&str>)?;
      let restart_item = MenuItem::with_id(app, "restart", "Restart Quinki", true, None::<&str>)?;
      let quit_item = MenuItem::with_id(app, "quit", "Quit Quinki", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show_item, &expert_item, &restart_item, &quit_item])?;

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
            "expert" => {
              // Open the separate Quinki Expert App from the main app bundle
              let exe = std::env::current_exe().unwrap_or_default();
              let main_dir = exe.parent().unwrap_or(std::path::Path::new("/"));
              let resources_dir = main_dir.parent().unwrap_or(std::path::Path::new("/")).join("Resources");
              let expert_app = resources_dir.join("Quinki Expert.app");
              if expert_app.exists() {
                let _ = std::process::Command::new("open")
                  .arg(&expert_app)
                  .spawn();
              }
            }
            "restart" => {
              // Kill sidecar processes
              let _ = std::process::Command::new("sh").arg("-c")
                .arg("pkill -f ws-bridge 2>/dev/null; pkill -f sidecar.ts 2>/dev/null; lsof -ti:9182 | xargs kill -9 2>/dev/null")
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
                .arg("pkill -f ws-bridge 2>/dev/null; pkill -f sidecar.ts 2>/dev/null; lsof -ti:9182 | xargs kill -9 2>/dev/null")
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
        
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/andreamaddalena".to_string());
        let sidecar_dir = format!("{}/Projects/Quinki/sidecar-src", home);
        
        if is_expert_mode() {
          // Expert mode: start expert sidecar on port 9183 + watchdog
          let start_script = format!("{}/start-expert.sh", sidecar_dir);
          let watchdog_script = format!("{}/expert-watchdog.sh", sidecar_dir);
          let _ = app.shell().command("sh")
            .args(["-c", &format!("bash '{}' &", start_script)])
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
      
      Ok(())
    })
    .on_window_event(|window, event| {
      // Close-to-tray: ONLY main window hides. Sub-windows close normally.
      if let WindowEvent::CloseRequested { api, .. } = event {
        if is_expert_mode() {
          // Expert app: close-to-tray (hide, don't quit)
          if window.label() == "main" && !SHOULD_EXIT.load(Ordering::SeqCst) {
            let _ = window.hide();
            api.prevent_close();
          }
        } else if window.label() == "main" && !SHOULD_EXIT.load(Ordering::SeqCst) {
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
          // Clean up PID file on exit
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