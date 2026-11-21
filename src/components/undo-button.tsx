import { Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The study screen's undo: steps back over the last answer (or pause). Stays
 * in place, dimmed, when there's nothing to undo, so the top bar doesn't shift.
 */
export function UndoButton({
  onUndo,
  disabled = false,
  className,
}: {
  onUndo: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onUndo}
      disabled={disabled}
      aria-label="Undo last answer"
      title="Undo (Z)"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-muted active:bg-raised disabled:opacity-30",
        className,
      )}
    >
      <Undo2 className="size-5" aria-hidden />
    </button>
  );
}
