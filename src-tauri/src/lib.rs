use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent, Emitter,
};

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
fn set_window_bg_color(_window: tauri::WebviewWindow, _color: String) {
  // No longer needed — titlebar is a CSS div with var(--q-bg)
  // Kept for compatibility with the JS invoke call
}

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

pub fn run() {
    let app = tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        set_window_bg_color,
        __drag_window,
        __toggle_maximize,
        export_chat_file,
        pick_directory,
    ])
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_log::Builder::default()
      .level(log::LevelFilter::Info)
      .build())
    .setup(|app| {
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

      // === Tray icon === (character only, no background)
      let show_item = MenuItem::with_id(app, "show", "Show Quinki", true, None::<&str>)?;
      let expert_item = MenuItem::with_id(app, "expert", "Open Quinki Expert", true, None::<&str>)?;
      let restart_item = MenuItem::with_id(app, "restart", "Restart Quinki", true, None::<&str>)?;
      let quit_item = MenuItem::with_id(app, "quit", "Quit Quinki", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show_item, &expert_item, &restart_item, &quit_item])?;

      // Load tray icon (character only, transparent background)
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
              if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
              }
            }
            "expert" => {
              if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.emit("tray-open-expert", ());
              }
            }
            "restart" => {
              // Kill sidecar processes
              let _ = std::process::Command::new("sh").arg("-c").arg("pkill -f ws-bridge 2>/dev/null; pkill -f sidecar.ts 2>/dev/null; lsof -ti:9182 | xargs kill -9 2>/dev/null").spawn();
              // Relaunch app after a short delay
              let exe = std::env::current_exe().unwrap_or_default();
              let app_path = exe.to_string_lossy().to_string();
              std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(300));
                let _ = std::process::Command::new("sh").arg("-c").arg(format!("(sleep 0.5 && '{}') &", app_path)).spawn();
              });
              app.exit(0);
            }
            "quit" => {
              // Kill sidecar processes
              let _ = std::process::Command::new("sh").arg("-c").arg("pkill -f ws-bridge 2>/dev/null; pkill -f sidecar.ts 2>/dev/null; lsof -ti:9182 | xargs kill -9 2>/dev/null").spawn();
              app.exit(0);
            }
            _ => {}
          }
        })
        .on_tray_icon_event(|tray, event| {
          if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
              let app = tray.app_handle();
              if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
              }
            }
          })
        .build(app)?;

      // === Sidecar start ===
      #[cfg(not(target_os = "windows"))]
      {
        use tauri_plugin_shell::ShellExt;
        
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/andreamaddalena".to_string());
        let sidecar_dir = format!("{}/Projects/Quinki/sidecar-src", home);
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
      
      Ok(())
    })
    .on_window_event(|window, event| {
      // Close-to-tray: hide window instead of closing
      if let WindowEvent::CloseRequested { api, .. } = event {
        #[cfg(target_os = "macos")]
        {
          use tauri::Manager;
          if let Some(win) = window.app_handle().get_webview_window("main") {
            let _ = win.hide();
          }
        }
        api.prevent_close();
      }
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

    app.run(|_app_handle, event| {
      // Keep app running in background (for tray)
      if let tauri::RunEvent::ExitRequested { api, .. } = event {
        #[cfg(target_os = "macos")]
        {
          api.prevent_exit();
        }
      }
    });
}