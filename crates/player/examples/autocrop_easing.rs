//! Draws the crop path of each easing (`polar_player::motion`), one dot per
//! frame at 24 fps, as docs/autocrop-easing.svg; `--table` prints the same
//! numbers as a Markdown table instead (docs/autocrop.md §6).
//!
//! ```text
//! cargo run -p polar-player --example autocrop_easing > docs/autocrop-easing.svg
//! cargo run -p polar-player --example autocrop_easing -- --table
//! ```

use std::fmt::Write;

use polar_player::motion::{path, Easing};

const FPS: f64 = 24.0;
const FRAMES: usize = 25; // just over 1 s
/// Plot area inside the picture, in SVG units.
const L: f64 = 64.0;
const T: f64 = 72.0;
const PW: f64 = 620.0;
const PH: f64 = 300.0;

fn main() {
    let paths: Vec<(Easing, Vec<f64>)> = Easing::ALL.into_iter().map(|e| (e, path(e, FPS, FRAMES))).collect();
    if std::env::args().any(|a| a == "--table") {
        print!("{}", table(&paths));
    } else {
        print!("{}", svg(&paths));
    }
}

fn ms(frame: usize) -> f64 {
    frame as f64 * 1000.0 / FPS
}

fn table(paths: &[(Easing, Vec<f64>)]) -> String {
    let mut out = String::from("| frame | ms |");
    for (e, _) in paths {
        write!(out, " {} |", e.name()).unwrap();
    }
    out += "\n|---|---|";
    out += &"---|".repeat(paths.len());
    out += "\n";
    for f in 0..FRAMES {
        write!(out, "| {f} | {:.0} |", ms(f)).unwrap();
        for (_, p) in paths {
            write!(out, " {:.0}% |", 100.0 * p.get(f).copied().unwrap_or(1.0)).unwrap();
        }
        out += "\n";
    }
    out
}

fn svg(paths: &[(Easing, Vec<f64>)]) -> String {
    let x = |frame: usize| L + PW * ms(frame) / ms(FRAMES - 1);
    let y = |v: f64| T + PH * (1.0 - v);
    let mut s = String::new();
    s += r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 430" width="720" height="430" font-family="system-ui, -apple-system, Segoe UI, sans-serif" role="img" aria-labelledby="t d">
<title id="t">Autocrop: the crop's path per frame for each easing</title>
<desc id="d">Share of the crop move done at each frame (24 fps) for ease-out, spring and ease-in-out; each dot is one frame. Numbers in docs/autocrop.md section 6.</desc>
<style>
  .bg { fill: #fcfcfb } .ink { fill: #1a1a19 } .ink2 { fill: #5f5e58 } .grid { stroke: #e4e3df } .axis { stroke: #8c8b84 }
  .s0 { stroke: #2a78d6; fill: #2a78d6 } .s1 { stroke: #eb6834; fill: #eb6834 } .s2 { stroke: #1baf7a; fill: #1baf7a }
  .l0 { stroke: #2a78d6 } .l1 { stroke: #eb6834 } .l2 { stroke: #1baf7a }
  .ring { stroke: #fcfcfb }
  @media (prefers-color-scheme: dark) {
    .bg { fill: #1a1a19 } .ink { fill: #f0efec } .ink2 { fill: #c3c2b7 } .grid { stroke: #33322f } .axis { stroke: #7a7972 }
    .s0 { stroke: #3987e5; fill: #3987e5 } .s1 { stroke: #d95926; fill: #d95926 } .s2 { stroke: #199e70; fill: #199e70 }
    .l0 { stroke: #3987e5 } .l1 { stroke: #d95926 } .l2 { stroke: #199e70 }
    .ring { stroke: #1a1a19 }
  }
  line, polyline { fill: none } polyline { stroke-width: 2; stroke-linejoin: round }
  circle { stroke-width: 2 } circle:hover { r: 6 }
</style>
<rect class="bg" width="720" height="430" rx="8"/>
<text class="ink" x="24" y="32" font-size="16" font-weight="600">How the crop moves, frame by frame (24 fps)</text>
"#;
    // Legend, in a row under the title.
    let mut lx = 24.0;
    for (i, (e, _)) in paths.iter().enumerate() {
        let label = match e {
            Easing::EaseOut => "ease-out (default)",
            other => other.name(),
        };
        writeln!(s, r#"<circle class="s{i} ring" cx="{}" cy="52" r="4"/><text class="ink2" x="{}" y="56" font-size="13">{label}</text>"#, lx + 4.0, lx + 14.0).unwrap();
        lx += 14.0 + label.len() as f64 * 7.0 + 24.0;
    }
    // Grid and axes.
    for pct in [0, 25, 50, 75, 100] {
        let gy = y(pct as f64 / 100.0);
        let class = if pct == 0 { "axis" } else { "grid" };
        writeln!(s, r#"<line class="{class}" x1="{L}" x2="{}" y1="{gy}" y2="{gy}"/><text class="ink2" x="{}" y="{}" font-size="12" text-anchor="end">{pct}%</text>"#, L + PW, L - 8.0, gy + 4.0).unwrap();
    }
    for t in [0, 250, 500, 750, 1000] {
        let gx = L + PW * t as f64 / ms(FRAMES - 1);
        writeln!(
            s,
            r#"<text class="ink2" x="{gx}" y="{}" font-size="12" text-anchor="middle">{t} ms</text>"#,
            T + PH + 20.0
        )
        .unwrap();
    }
    writeln!(
        s,
        r#"<text class="ink2" x="{}" y="{}" font-size="12" text-anchor="middle">time since the move started</text>"#,
        L + PW / 2.0,
        T + PH + 42.0
    )
    .unwrap();
    writeln!(s, r#"<text class="ink2" x="16" y="{}" font-size="12" transform="rotate(-90 16 {})" text-anchor="middle">share of the move done</text>"#, T + PH / 2.0, T + PH / 2.0).unwrap();
    // One line and one dot per frame for each easing; a settled move holds at 100%.
    for (i, (e, p)) in paths.iter().enumerate() {
        let value = |f: usize| p.get(f).copied().unwrap_or(1.0);
        let points: Vec<String> = (0..FRAMES).map(|f| format!("{:.1},{:.1}", x(f), y(value(f)))).collect();
        writeln!(s, r#"<polyline class="l{i}" points="{}"/>"#, points.join(" ")).unwrap();
        for f in 0..p.len() {
            writeln!(
                s,
                r#"<circle class="s{i} ring" cx="{:.1}" cy="{:.1}" r="4"><title>{}: frame {f}, {:.0} ms, {:.0}%</title></circle>"#,
                x(f),
                y(value(f)),
                e.name(),
                ms(f),
                100.0 * value(f)
            )
            .unwrap();
        }
    }
    s += "</svg>\n";
    s
}
