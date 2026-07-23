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
        use cocoa::appkit::{NSWindow, NSView, NSViewAutoresizingMask};
        use cocoa::base::id;
        use objc::msg_send;
        use objc::sel;
        use objc::sel_impl;
        use objc::runtime::YES;
        let ns_window = window.ns_window().unwrap() as id;
        unsafe {
            ns_window.setTitlebarAppearsTransparent_(YES);
            let _: () = msg_send![ns_window, setOpaque: NO];
            // Set background color to match theme (#08080b)
            use cocoa::appkit::NSColor;
            let bg_color = NSColor::colorWithDeviceWhite_red_green_blue_alpha(nil, 0.031, 0.031, 0.043, 1.0);
            ns_window.setBackgroundColor_(bg_color);
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
            log::info!("Sidecar start script launched — rebuild v54 BUILDRS");
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
