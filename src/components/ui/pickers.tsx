import { Check } from "lucide-react";
import { SWATCHES, cn, colorValue, swatchHex } from "@/lib/cn";

export function ColorPicker({ value, onChange, label = "Color" }: { value: string; onChange: (color: string) => void; label?: string }) {
  const isCustom = value.startsWith("#");
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-ink">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            onClick={() => onChange(swatch)}
            className={cn(
              "grid size-9 place-items-center rounded-full ring-offset-2 ring-offset-surface transition",
              value === swatch ? "ring-2 ring-ink" : "hover:scale-105",
            )}
            style={{ background: colorValue(swatch) }}
            aria-label={swatch}
            aria-pressed={value === swatch}
          >
            {value === swatch ? <Check className="size-4 text-ink" aria-hidden="true" /> : null}
          </button>
        ))}
        <label
          className={cn(
            "relative grid size-9 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed border-line-strong text-xs text-ink-soft ring-offset-2 ring-offset-surface",
            isCustom && "ring-2 ring-ink",
          )}
          style={isCustom ? { background: value } : undefined}
          title="Custom color"
        >
          {isCustom ? null : "+"}
          <input
            type="color"
            value={isCustom ? value : swatchHex("lavender")}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Custom color"
          />
        </label>
      </div>
    </fieldset>
  );
}

const EMOJIS = ["🎯", "🕌", "🏠", "🚗", "✈️", "💻", "💰", "📈", "🪙", "🎓", "💍", "🇦🇺"];

export function EmojiPicker({ value, onChange, id }: { value: string; onChange: (emoji: string) => void; id?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={16}
        className="h-11 w-24 rounded-xl border border-line-strong bg-surface text-center text-2xl focus:border-focus focus:ring-3 focus:ring-brand focus:outline-none"
        aria-label="Emoji"
      />
      <div className="flex flex-wrap gap-1.5">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onChange(emoji)}
            className={cn(
              "grid size-10 place-items-center rounded-xl text-xl transition hover:bg-surface-muted",
              value === emoji && "bg-brand",
            )}
            aria-label={`Use ${emoji}`}
            aria-pressed={value === emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
