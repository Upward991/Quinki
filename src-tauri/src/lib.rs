#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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
        use objc::runtime::Object; type id = *mut Object;
        use objc::{msg_send, sel, sel_impl};
        use objc::runtime::YES;
        let ns_window = window.ns_window().unwrap() as id;
        unsafe {
            // Same approach as Flutter CatBoard:
            // 1. fullSizeContentView — content extends behind titlebar (enables drag)
            let style_mask: u64 = msg_send![ns_window, styleMask];
            // NSFullSizeContentViewWindowMask = 1 << 15 = 32768
            let new_mask = style_mask | 32768;
            let _: () = msg_send![ns_window, setStyleMask: new_mask];
            // 2. titlebar transparent
            let _: () = msg_send![ns_window, setTitlebarAppearsTransparent: YES];
            // 3. opaque window with solid bg (like Flutter: isOpaque = true)
            let _: () = msg_send![ns_window, setOpaque: YES];
            // 4. bg color #08080b
            let ns_color_cls = objc::class!(NSColor);
            let bg: id = msg_send![ns_color_cls, colorWithSRGBRed: 0.031f64 green: 0.031f64 blue: 0.043f64 alpha: 1.0f64];
            let _: () = msg_send![ns_window, setBackgroundColor: bg];
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
            log::info!("Sidecar start script launched — rebuild v58 BUILDRS");
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
