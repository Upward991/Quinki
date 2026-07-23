#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tauri::command]
fn set_window_bg_color(window: tauri::WebviewWindow, color: String) {
  let hex = color.trim().trim_start_matches('#');
  if hex.len() == 6 {
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(8);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(8);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(11);
    // Set webview bg (with transparent feature, this makes WKWebView draw our color)
    let _ = window.set_background_color(Some(tauri::webview::Color(r, g, b, 255)));
    // Also set NSWindow bg for the titlebar area
    #[cfg(target_os = "macos")]
    {
      use objc::runtime::Object; type id = *mut Object;
      use objc::{msg_send, sel, sel_impl};
      let ns_window = window.ns_window().unwrap() as id;
      unsafe {
        let ns_color_cls = objc::class!(NSColor);
        let bg: id = msg_send![ns_color_cls, colorWithSRGBRed: r as f64 / 255.0 green: g as f64 / 255.0 blue: b as f64 / 255.0 alpha: 1.0f64];
        let _: () = msg_send![ns_window, setBackgroundColor: bg];
      }
    }
  }
}

pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![set_window_bg_color])
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_log::Builder::default()
      .level(log::LevelFilter::Info)
      .build())
    .setup(|app| {
      #[cfg(target_os = "macos")]
      {
        use tauri::Manager;
        let window = app.get_webview_window("main").unwrap();
        eprintln!("[QUINKI] Setting NSWindow background color to #08080b");
        use objc::runtime::Object; type id = *mut Object;
        use objc::{msg_send, sel, sel_impl};
        let ns_window = window.ns_window().unwrap() as id;
        unsafe {
          let ns_color_cls = objc::class!(NSColor);
          let bg: id = msg_send![ns_color_cls, colorWithDeviceRed: 0.031f64 green: 0.031f64 blue: 0.043f64 alpha: 1.0f64];
          let _: () = msg_send![ns_window, setBackgroundColor: bg];
          eprintln!("[QUINKI] NSWindow background color set successfully");
        }
      }
      #[cfg(not(target_os = "windows"))]
      {
        use tauri_plugin_shell::ShellExt;
        
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/andreamaddalena".to_string());
        let sidecar_dir = format!("{}/Projects/Quinki/sidecar-src", home);
        let start_script = format!("{}/start.sh", sidecar_dir);
        
        // Use sh to run start.sh — this kills old sidecar and starts new one
        let cmd = app.shell().command("sh")
          .args(["-c", &format!("bash '{}' &", start_script)]);
        
        match cmd.spawn() {
          Ok((mut rx, _child)) => {
            log::info!("Sidecar start script launched — rebuild v91 BUILDRS");
            std::thread::spawn(move || {
              while let Some(_event) = rx.blocking_recv() {}
            });
          }
          Err(e) => {
            log::error!("Failed to start sidecar: {}", e);
          }
        }
      }
      
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
