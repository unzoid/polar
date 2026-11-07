/**
 * How far past a panel's edge a click still counts as a miss, not as a click away from it (#202, #320): a missed
 * click there does nothing, one beyond it closes the panel. Wider to the left and right, where moving across a
 * panel's columns overshoots its edge; a finger gets more room than a mouse.
 */
export function missMargin(pointerType: string): { x: number; y: number } {
  return pointerType === "touch" ? { x: 96, y: 40 } : { x: 64, y: 24 };
}
