"use client";

import { cn } from "@/lib/utils";

export type Direction = "RECOGNITION" | "PRODUCTION" | "BOTH";

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
  className,
}: {
  /** Language names, e.g. "Swedish" / "English". */
  target: string;
  source: string;
  name?: string;
  value?: Direction;
  defaultValue?: Direction;
  onChange?: (direction: Direction) => void;
  className?: string;
}) {
  const options: { value: Direction; label: string; hint: string }[] = [
    { value: "RECOGNITION", label: `${target} first`, hint: `See ${target}, recall ${source}` },
    { value: "PRODUCTION", label: `${source} first`, hint: `See ${source}, produce ${target}` },
    { value: "BOTH", label: "Both", hint: "One card each way" },
  ];

  return (
    <fieldset className={cn("grid grid-cols-3 gap-1 rounded-xl border border-line bg-raised p-1", className)}>
      <legend className="sr-only">Card direction</legend>
      {options.map((option) => (
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
              : { defaultChecked: defaultValue === option.value })}
          />
          <span className="block truncate">{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
