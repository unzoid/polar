import { Slider } from "@base-ui/react/slider";
import { useEffect, useState } from "react";

/**
 * A number setting: drag the slider, or type the exact value in the box
 * beside it (Enter or leaving the box saves). `zero` names what 0 means
 * ("Never", "Any size") and shows in the box when it's 0.
 */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  zero,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Shown after the number: "s", "GB", "%". */
  unit?: string;
  zero?: string;
  onChange: (n: number) => void;
}) {
  const decimals = step < 1 ? String(step).split(".")[1]?.length ?? 1 : 0;
  const clamp = (n: number) => Math.min(max, Math.max(min, Number(n.toFixed(decimals))));
  const show = (n: number) => (n === 0 && zero ? "" : String(Number(n.toFixed(decimals))));
  // The slider moves the number at once; saving waits until you let go.
  const [live, setLive] = useState(value);
  const [text, setText] = useState(show(value));
  useEffect(() => {
    setLive(value);
    setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commitText = () => {
    const raw = text.trim().replace(",", ".");
    const n = raw === "" && zero ? 0 : Number(raw);
    if (!Number.isFinite(n)) return setText(show(value));
    const next = clamp(n);
    setText(show(next));
    setLive(next);
    if (next !== value) onChange(next);
  };

  return (
    <div className="slider-field">
      <Slider.Root
        className="slider-field-slider"
        value={live}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => {
          const n = v as number;
          setLive(n);
          setText(show(n));
        }}
        onValueCommitted={(v) => (v as number) !== value && onChange(v as number)}
      >
        <Slider.Control className="srcf-slider-control">
          <Slider.Track className="srcf-slider-track">
            <Slider.Indicator className="srcf-slider-fill" />
            <Slider.Thumb className="srcf-slider-thumb" getAriaLabel={() => label} />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      <label className="slider-field-box" data-zero={live === 0 && !!zero}>
        <input
          type="text"
          inputMode="decimal"
          value={text}
          placeholder={zero}
          aria-label={label}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.stopPropagation();
              setText(show(value));
              e.currentTarget.blur();
            }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const next = clamp((Number(text.replace(",", ".")) || 0) + (e.key === "ArrowUp" ? step : -step));
              setText(show(next));
              setLive(next);
            }
          }}
        />
        {unit && !(live === 0 && zero) && <span className="slider-field-unit">{unit}</span>}
      </label>
    </div>
  );
}
