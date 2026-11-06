/** Whether a key press asks for options on what's focused: the Menu key, Shift+F10, or a controller's X / Square. */
export const isMenuKey = (e: { key: string; shiftKey: boolean }) => e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
