# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Called by name from Rust and from the page: MpvSurface's native methods
# (src-tauri/src/player/android.rs) and the polarDevice interface (MainActivity.kt).
-keepclasseswithmembernames class app.getpolar.desktop.MpvSurface {
    native <methods>;
}
-keepclassmembers class app.getpolar.desktop.PolarDevice {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class app.getpolar.desktop.PolarNotes {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class app.getpolar.desktop.PolarNotesWithActions {
    @android.webkit.JavascriptInterface <methods>;
}
# The phone's keychain, looked up and called by name from src-tauri/src/keychain.rs.
-keep class app.getpolar.desktop.PolarKeys {
    public static *** get(android.content.Context, java.lang.String);
    public static *** set(android.content.Context, java.lang.String, byte[]);
    public static *** delete(android.content.Context, java.lang.String);
}
