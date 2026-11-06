fn main() {
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    // Where libmpv runs inside the app instead of as its own mpv process (src/player/mod.rs):
    // `mpv_in_app` on macOS, iOS and Android; `mpv_apple` where it draws through the view in
    // src/macos/mpv_view.m or src/ios/mpv_view.m (player/apple.rs).
    println!("cargo::rustc-check-cfg=cfg(mpv_in_app)");
    println!("cargo::rustc-check-cfg=cfg(mpv_apple)");
    if matches!(os.as_str(), "macos" | "ios" | "android") {
        println!("cargo:rustc-cfg=mpv_in_app");
    }
    if matches!(os.as_str(), "macos" | "ios") {
        println!("cargo:rustc-cfg=mpv_apple");
    }
    // libmpv itself is loaded at runtime, so only the system frameworks are linked here. On
    // iOS the app is a static library Xcode links: its frameworks are listed in
    // tauri.ios.conf.json (`bundle.iOS.frameworks`) instead.
    let native: &[&str] = match os.as_str() {
        "macos" => &["src/macos/mpv_view.m"],
        "ios" => {
            &["src/ios/mpv_view.m", "src/ios/files.m", "src/ios/system_bars.m", "src/ios/tabs.m", "src/ios/dialogs.m"]
        }
        _ => &[],
    };
    if !native.is_empty() {
        for file in native {
            println!("cargo:rerun-if-changed={file}");
        }
        println!("cargo:rerun-if-changed=src/apple/libmpv.h");
        cc::Build::new().files(native).flag("-fobjc-arc").flag("-fmodules").compile("polar_native");
    }
    if os == "macos" {
        for framework in ["Cocoa", "QuartzCore", "OpenGL"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    tauri_build::build()
}
