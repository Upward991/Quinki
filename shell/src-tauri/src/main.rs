// Quinki desktop shell (Windows / Linux / portable): loads the Quinki web app
// from the user's own server (link + token, same pairing as the phone). The
// backend (sidecar) stays where it is; this shell is just a window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn config_path() -> std::path::PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::Path::new(&home).join(".quinki-shell").join("config.json")
}

fn load_config() -> Option<serde_json::Value> {
    let p = config_path();
    let s = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(&s).ok()
}

fn server_url(cfg: &serde_json::Value) -> Option<String> {
    let link = cfg.get("link")?.as_str()?.trim_end_matches('/');
    let token = cfg.get("token")?.as_str()?;
    if link.is_empty() || token.is_empty() { return None; }
    Some(format!("{}/?token={}", link, token))
}

fn navigate_to_server(app: &tauri::AppHandle) -> Result<(), String> {
    let cfg = load_config().ok_or("no config")?;
    let url = server_url(&cfg).ok_or("invalid config")?;
    let w = app.get_webview_window("main").ok_or("no window")?;
    let u: tauri::Url = url.parse().map_err(|e| format!("bad url: {}", e))?;
    w.navigate(u).map_err(|e| format!("navigate failed: {}", e))
}

#[tauri::command]
fn shell_connect(app: tauri::AppHandle, link: String, token: String) -> Result<(), String> {
    let dir = config_path().parent().map(|p| p.to_path_buf()).ok_or("no dir")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let cfg = serde_json::json!({ "link": link.trim_end_matches('/'), "token": token });
    std::fs::write(config_path(), serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| e.to_string())?;
    navigate_to_server(&app)
}

#[tauri::command]
fn shell_config() -> Option<serde_json::Value> { load_config() }

#[tauri::command]
fn get_window_label() -> &'static str { "main" }

#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![shell_connect, shell_config, get_window_label, open_url])
        .setup(|app| {
            let _ = navigate_to_server(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Quinki");
}
