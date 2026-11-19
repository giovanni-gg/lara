"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui";

/**
 * A submit button that asks first. For actions that are easy to tap by
 * accident and annoying to undo (archiving a deck). Uses the browser's own
 * confirm dialog — native on phones, no extra UI to build.
 */
export function ConfirmSubmit({
  message,
  ...props
}: ComponentProps<typeof Button> & { message: string }) {
  return (
    <Button
      {...props}
      type="submit"
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    />
  );
}
