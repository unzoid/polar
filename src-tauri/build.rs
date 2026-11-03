fn main() {
    // macOS: mpv runs inside the app (see src/macos/mpv_view.m). libmpv itself
    // is loaded at runtime, so only the system frameworks are linked here.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=src/macos/mpv_view.m");
        cc::Build::new().file("src/macos/mpv_view.m").flag("-fobjc-arc").flag("-fmodules").compile("polar_mpv_view");
        for framework in ["Cocoa", "QuartzCore", "OpenGL"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    tauri_build::build()
}
