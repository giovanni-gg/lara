"use client";

import type { CardDirection } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

/** What new cards can be added as. BOTH stays valid on old decks, but isn't offered. */
export type Direction = Exclude<CardDirection, "BOTH">;

export function directionOptions(target: string, source: string) {
  return [
    { value: "RECOGNITION", label: `${target} first`, hint: `See ${target}, recall ${source}` },
    { value: "PRODUCTION", label: `${source} first`, hint: `See ${source}, produce ${target}` },
    { value: "PICTURE", label: "Picture first", hint: `See a picture, produce ${target}` },
  ] satisfies { value: Direction; label: string; hint: string }[];
}

/** A deck's stored direction as a picker choice: an old BOTH deck starts on the first. */
export function pickerDirection(direction: CardDirection): Direction {
  return direction === "BOTH" ? "RECOGNITION" : direction;
}

/**
 * Which side of a card you see first. Works inside a plain <form> (radios
 * named `name`) or controlled via `value`/`onChange`.
 */
export function DirectionPicker({
  target,
  source,
  name = "direction",
  value,
  defaultValue = "RECOGNITION",
  onChange,
  picturesAvailable = true,
  className,
}: {
  /** Language names, e.g. "Swedish" / "English". */
  target: string;
  source: string;
  name?: string;
  value?: Direction;
  defaultValue?: CardDirection;
  onChange?: (direction: Direction) => void;
  /** False when the server can't draw pictures (no GEMINI_API_KEY). */
  picturesAvailable?: boolean;
  className?: string;
}) {
  const initial = pickerDirection(defaultValue);

  return (
    // The note shows only while "Picture first" is picked, without any state.
    <div className={cn("[&:has(input[value=PICTURE]:checked)>p]:block", className)}>
      <fieldset className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-raised p-1">
        <legend className="sr-only">Card direction</legend>
        {directionOptions(target, source).map((option) => (
          <label
            key={option.value}
            title={option.hint}
            className="cursor-pointer rounded-lg px-1 py-1.5 text-center text-xs font-medium text-muted has-checked:bg-surface has-checked:text-foreground has-checked:shadow-sm"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              className="sr-only"
              {...(value !== undefined
                ? { checked: value === option.value, onChange: () => onChange?.(option.value) }
                : { defaultChecked: initial === option.value })}
            />
            <span className="block truncate">{option.label}</span>
          </label>
        ))}
      </fieldset>
      {picturesAvailable ? null : (
        <p className="mt-1 hidden text-xs text-muted">
          Pictures aren&apos;t set up (GEMINI_API_KEY), so these cards show the {source} word
          instead.
        </p>
      )}
    </div>
  );
}
