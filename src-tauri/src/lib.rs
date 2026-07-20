#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_log::Builder::default()
      .level(log::LevelFilter::Info)
      .build())
    .setup(|app| {
      #[cfg(not(target_os = "windows"))]
      {
        use tauri_plugin_shell::ShellExt;
        use std::process::Command;
        
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/andreamaddalena".to_string());
        let agent_dir = format!("{}/.pi/agent-quinki-dev", home);
        let project_dir = format!("{}/Projects/Quinki", home);
        let sidecar_dir = format!("{}/sidecar-src", project_dir);
        
        // Kill any existing process on port 9182
        let _ = Command::new("sh")
          .args(["-c", "lsof -ti:9182 | xargs kill -9 2>/dev/null; pkill -f 'ws-bridge' 2>/dev/null; sleep 1"])
          .output();
        
        log::info!("Killed old sidecar processes");
        
        // Spawn ws-bridge.ts
        let cmd = app.shell().command("npx")
          .args(["tsx", "ws-bridge.ts"])
          .current_dir(&sidecar_dir)
          .env("QUINKI_AGENT_DIR", &agent_dir);
        
        match cmd.spawn() {
          Ok((mut rx, _child)) => {
            log::info!("Sidecar started");
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
