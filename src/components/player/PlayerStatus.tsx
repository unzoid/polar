import { motion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { Sources } from "../icons";
import { Img } from "../Img";
import { Button } from "../ui/Button";
import { ease } from "../../lib/ui";
import { osName } from "../../lib/platform";
import { appVersion } from "../../lib/updater";
import { failedStage, formatReport, STAGE_LABEL, type StartStage, type StartStep } from "../../lib/playback";
import type { useSource } from "./useSource";

/** How far the logo has filled in for each loading stage (0–100). */
const FILL = { searching: 34, resolving: 66, starting: 92, done: 100 } as const;

/** Past this many characters a name without a logo is set smaller, so its words fit whole on two lines. */
const LONG_NAME = 24;

/**
 * Loading screen, Netflix-style: the title's logo (or name) sits greyed out
 * and fills with colour left to right as loading advances — finding a source,
 * connecting, buffering the first frames. Real stages, not a fake timer: each
 * one moves the fill further, and a slow creep within a stage shows life
 * while a slow server answers.
 *
 * Under it, the steps as they happen (lib/playback/startLog); on failure, which step
 * failed, and a button that copies the whole log for a bug report.
 */
export function PlayerStatus({
  state,
  error,
  logo,
  name,
  background,
  steps,
  backend,
  onSources,
}: {
  state: ReturnType<typeof useSource>["state"];
  error: string | null;
  logo?: string;
  name?: string;
  background?: string;
  steps: StartStep[];
  backend: string;
  /** Left out where there's nothing else to choose (a pasted link). */
  onSources?: () => void;
}) {
  const failed = state.status === "failed" || !!error;
  const stageAt = failed ? failedStage(steps) : undefined;

  const stage = state.status === "searching" ? "searching" : state.status === "resolving" || state.status === "notice" ? "resolving" : "starting";
  const message = failed
    ? (error ?? (state.status === "failed" ? state.reason : ""))
    : stage === "searching"
      ? "Finding the best source"
      : stage === "resolving"
        ? `Connecting${(state.status === "resolving" || state.status === "notice") && state.label ? ` · ${state.label}` : ""}`
        : "Starting";

  return (
    <motion.div
      className="player-status"
      data-failed={failed}
      exit={{ opacity: 0, transition: { duration: 0.26, ease: ease.out } }}
    >
      {background && <Img src={background} alt="" className="player-status-bg" />}
      <div className="player-status-content">
        <div
          className="load-mark"
          data-long={!logo && (name?.length ?? 0) > LONG_NAME}
          style={{ "--fill": `${failed ? 0 : FILL[stage]}%` } as React.CSSProperties}
        >
          {logo ? (
            <>
              <img src={logo} alt={name ?? ""} className="load-mark-base" />
              <img src={logo} alt="" aria-hidden className="load-mark-fill" />
            </>
          ) : (
            <>
              <span className="load-mark-base load-mark-text">{name}</span>
              <span aria-hidden className="load-mark-fill load-mark-text">
                {name}
              </span>
            </>
          )}
        </div>
        <p key={message} className="player-status-message t-callout" role="status">
          {message}
        </p>
        {stageAt && <p className="player-status-where t-caption">Failed at {STAGE_LABEL[stageAt]}</p>}
        <StartSteps steps={steps} all={failed} />
        {failed && (
          <div className="player-status-actions">
            {/* Focused, so Enter (or a controller's A) picks it straight away. */}
            {onSources && (
              <Button variant="primary" onClick={onSources} autoFocus>
                <Sources size={17} /> Choose Another Source
              </Button>
            )}
            <CopyDetails steps={steps} backend={backend} outcome={message} stage={stageAt} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** Lines shown while loading; failed, the whole log scrolls. */
const STEPS_SHOWN = 5;

function StartSteps({ steps, all }: { steps: StartStep[]; all: boolean }) {
  const list = useRef<HTMLOListElement>(null);
  const shown = all ? steps : steps.slice(-STEPS_SHOWN);
  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, all]);
  if (!shown.length) return null;
  return (
    <ol ref={list} className="player-steps" data-all={all} aria-label="Loading steps">
      {shown.map((s, i) => (
        <li key={steps.length - shown.length + i} data-tone={s.tone} data-current={!all && i === shown.length - 1}>
          <span className="player-step-time">{(s.at / 1000).toFixed(1)}s</span>
          <span className="player-step-text">{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** Copies the redacted log, with app version, platform and player, for a bug report. */
function CopyDetails({ steps, backend, outcome, stage }: { steps: StartStep[]; backend: string; outcome: string; stage?: StartStage }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const copy = async () => {
    const app = await appVersion().catch(() => "unknown");
    const text = formatReport(steps, { app, platform: osName, backend, outcome, stage });
    navigator.clipboard.writeText(text).then(
      () => setCopied("yes"),
      () => setCopied("no"),
    );
    window.setTimeout(() => setCopied(null), 2500);
  };
  return (
    <Button variant="glass" onClick={() => void copy()}>
      {copied === "yes" ? "Copied" : copied === "no" ? "Couldn't copy" : "Copy Details"}
    </Button>
  );
}
