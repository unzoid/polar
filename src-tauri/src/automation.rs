//! WebDriver sessions on Windows (e2e/app/smoke.ts through tauri-driver).
//!
//! msedgedriver gives WebView2 its DevTools port and profile folder through
//! `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` and `WEBVIEW2_USER_DATA_FOLDER`.
//! Since WebView2 Runtime 150 an elevated process (GitHub's Windows runners)
//! ignores that variable, so the port never opens and the session fails with
//! "DevToolsActivePort file doesn't exist". Debug builds therefore pass the
//! driver's arguments and folder through the WebView2 API, which is honoured.
//! Release builds create the window from the config alone.

use std::path::PathBuf;

/// What the main window needs under a driver: the config's own arguments with
/// the driver's appended, and the driver's profile folder. `None` outside a
/// WebDriver session, so the window is created exactly as configured.
#[derive(Debug, PartialEq, Eq)]
pub struct DriverWebview {
    pub args: String,
    pub data_directory: Option<PathBuf>,
}

pub fn driver_webview(config_args: Option<&str>, env: impl Fn(&str) -> Option<String>) -> Option<DriverWebview> {
    let driver_args = env("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").filter(|a| !a.trim().is_empty())?;
    let args = match config_args.map(str::trim).filter(|a| !a.is_empty()) {
        Some(own) => format!("{own} {}", driver_args.trim()),
        None => driver_args.trim().to_string(),
    };
    let data_directory = env("WEBVIEW2_USER_DATA_FOLDER").filter(|d| !d.trim().is_empty()).map(PathBuf::from);
    Some(DriverWebview { args, data_directory })
}

/// Creates the main window (`create: false` in tauri.windows.conf.json).
#[cfg(windows)]
pub fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    let Some(config) = app.config().app.windows.first().cloned() else {
        return Ok(());
    };
    let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
    let driver = driver_webview(config.additional_browser_args.as_deref(), |k| std::env::var(k).ok())
        .filter(|_| cfg!(debug_assertions));
    if let Some(driver) = driver {
        tracing::info!("WebDriver session: WebView2 arguments passed through the API");
        builder = builder.additional_browser_args(&driver.args);
        if let Some(dir) = driver.data_directory {
            builder = builder.data_directory(dir);
        }
    }
    builder.build()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(vars: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |k| vars.iter().find(|(name, _)| *name == k).map(|(_, v)| v.to_string())
    }

    #[test]
    fn no_driver_no_change() {
        assert_eq!(driver_webview(Some("--own"), env(&[])), None);
        assert_eq!(driver_webview(Some("--own"), env(&[("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", " ")])), None);
    }

    #[test]
    fn driver_args_follow_the_configs_own() {
        let vars = [
            ("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--remote-debugging-port=0 --test-type=webdriver"),
            ("WEBVIEW2_USER_DATA_FOLDER", "C:\\Temp\\scoped_dir1"),
        ];
        let got =
            driver_webview(Some("--disable-features=msWebOOUI --autoplay-policy=no-user-gesture-required"), env(&vars))
                .unwrap();
        assert_eq!(got.args, "--disable-features=msWebOOUI --autoplay-policy=no-user-gesture-required --remote-debugging-port=0 --test-type=webdriver");
        assert_eq!(got.data_directory, Some(PathBuf::from("C:\\Temp\\scoped_dir1")));
    }

    #[test]
    fn driver_args_alone_without_a_folder() {
        let got = driver_webview(None, env(&[("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--remote-debugging-port=0")]))
            .unwrap();
        assert_eq!(got, DriverWebview { args: "--remote-debugging-port=0".into(), data_directory: None });
    }
}
