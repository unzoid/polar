import { describe, expect, test } from "bun:test";
import "./storageStub";
import { fromPortable, toPortable } from "../src/lib/settings/keybinds";

describe("portable shortcuts (L5)", () => {
  test("this OS's modifier travels as Mod and lands as the other OS's", () => {
    expect(toPortable("Ctrl+k", "Ctrl")).toBe("Mod+k");
    expect(fromPortable("Mod+k", "Meta")).toBe("Meta+k");
    expect(toPortable("Meta+Shift+ArrowLeft", "Meta")).toBe("Mod+Shift+ArrowLeft");
  });
  test("other modifiers, plain keys and a key named like a modifier stay as they are", () => {
    expect(toPortable("Meta+k", "Ctrl")).toBe("Meta+k");
    expect(toPortable("Alt+k", "Ctrl")).toBe("Alt+k");
    expect(toPortable("/", "Ctrl")).toBe("/");
    expect(fromPortable("Ctrl+k", "Meta")).toBe("Ctrl+k");
    expect(fromPortable("Mod", "Meta")).toBe("Mod");
  });
});
