import { on } from "../../lib/platform";
import { useCallback, useRef, useState } from "react";
import { describeProbe, redact, type ProbeEvent, type StartStage, type StartStep, type StepTone } from "../../lib/playback";

/** Lines kept; a start that needs more than this is long past being readable. */
const MAX_STEPS = 200;

export type LogStep = (text: string, tone?: StepTone, stage?: StartStage, key?: string) => void;

/**
 * The loading screen's step log (see lib/playback/startLog). `add` stamps each line
 * with the time since the player opened and redacts it; a line with the same
 * `key` as the one before replaces it (buffering 10% → 40% is one line).
 */
export function useStartLog() {
  const t0 = useRef(performance.now());
  const keyOfLast = useRef<string | undefined>(undefined);
  const [steps, setSteps] = useState<StartStep[]>([]);
  const add = useCallback<LogStep>((text, tone = "info", stage, key) => {
    const step = { at: performance.now() - t0.current, text: redact(text), tone, stage };
    const replace = key != null && keyOfLast.current === key;
    keyOfLast.current = key;
    setSteps((s) => (replace ? [...s.slice(0, -1), step] : s.length >= MAX_STEPS ? s : [...s, step]));
  }, []);
  return { steps, add };
}

let probeIds = 0;
/** A fresh id for one link check, so a late event from the last one isn't shown. */
export const nextProbeId = () => ++probeIds;

/** The backend's link-check steps for probe `id` (`player://probe`), until unlistened. */
export function listenProbe(id: number, handler: (e: ProbeEvent) => void) {
  return on<{ id: number; event: ProbeEvent }>("player://probe", (p) => {
    if (p.id === id) handler(p.event);
  });
}

/** A probe event as a log line (the shape `LogStep` takes). */
export function probeStep(e: ProbeEvent): Parameters<LogStep> {
  const { text, tone, stage } = describeProbe(e);
  return [text, tone, stage];
}
