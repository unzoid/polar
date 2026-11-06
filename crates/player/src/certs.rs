//! A certificate bundle for TLS libraries that read one PEM file (mbedTLS in the Android
//! build of mpv) from a folder of certificate files such as Android's
//! `/system/etc/security/cacerts`, where each file holds one PEM block and a text dump.

use std::path::Path;

/// Every PEM certificate block of the files in `dir`, in file name order, one per line group.
pub fn pem_bundle(dir: &Path) -> std::io::Result<String> {
    const BEGIN: &str = "-----BEGIN CERTIFICATE-----";
    const END: &str = "-----END CERTIFICATE-----";
    let mut files: Vec<_> = std::fs::read_dir(dir)?.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    files.sort();
    let mut out = String::new();
    for file in files {
        let Ok(text) = std::fs::read_to_string(&file) else { continue };
        let mut rest = text.as_str();
        while let Some(start) = rest.find(BEGIN) {
            let Some(len) = rest[start..].find(END) else { break };
            let end = start + len + END.len();
            out.push_str(&rest[start..end]);
            out.push('\n');
            rest = &rest[end..];
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(body: &str) -> String {
        format!("-----BEGIN CERTIFICATE-----\n{body}\n-----END CERTIFICATE-----")
    }

    #[test]
    fn keeps_only_certificate_blocks_in_file_order() {
        let dir = std::env::temp_dir().join(format!("polar-certs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("b.0"), format!("{}\nCertificate:\n    Data: text dump\n", block("BBB"))).unwrap();
        std::fs::write(dir.join("a.0"), format!("{}\n{}\n", block("AAA"), block("CCC"))).unwrap();
        std::fs::write(dir.join("c.0"), "no certificate here").unwrap();
        std::fs::write(dir.join("d.0"), "-----BEGIN CERTIFICATE-----\ncut off").unwrap();
        let pem = pem_bundle(&dir);
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(pem.unwrap(), format!("{}\n{}\n{}\n", block("AAA"), block("CCC"), block("BBB")));
    }

    #[test]
    fn missing_folder_is_an_error() {
        assert!(pem_bundle(Path::new("/nonexistent/polar-certs")).is_err());
    }
}
