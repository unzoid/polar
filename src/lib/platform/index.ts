// What differs between the systems Polar runs on, behind one interface per concern: the native bridge (commands and
// events), the window, updates, the device and its form factor. docs/ARCHITECTURE.md says what each platform provides.
// Its public surface: code outside src/lib imports this folder, code inside src/lib imports the file.

export * from "./bridge";
export * from "./device";
export * from "./formFactor";
export * from "./updates";
export * from "./window";
