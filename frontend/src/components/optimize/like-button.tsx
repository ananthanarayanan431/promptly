"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLikeMutation, useUnlikeByVersionMutation } from "@/hooks/use-favorites";

interface LikeButtonProps {
  promptVersionId: string;
  isFavorited: boolean;
  favoriteId: string | null;
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
  onToggled?: (nowFavorited: boolean, newFavoriteId: string | null) => void;
}

export function LikeButton({
  promptVersionId,
  isFavorited,
  favoriteId: _favoriteId,
  size = "md",
  className,
  disabled = false,
  onToggled,
}: LikeButtonProps) {
  const like = useLikeMutation();
  const unlike = useUnlikeByVersionMutation();
  const isPending = like.isPending || unlike.isPending;

  async function handleClick() {
    if (isPending) return;
    if (isFavorited) {
      await unlike.mutateAsync(promptVersionId);
      onToggled?.(false, null);
    } else {
      const result = await like.mutateAsync({ prompt_version_id: promptVersionId });
      onToggled?.(true, result.id);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending || disabled}
      title={disabled ? "Run the optimization first to save it" : isFavorited ? "Remove from prompt store" : "Save to prompt store"}
      aria-label={isFavorited ? "Remove from prompt store" : "Save to prompt store"}
      className={cn(
        "inline-flex items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-7 w-7" : "h-9 w-9",
        isFavorited
          ? "text-rose-500 hover:text-rose-400"
          : "text-muted-foreground hover:text-rose-500",
        className
      )}
    >
      <Heart
        className={cn(
          size === "sm" ? "h-4 w-4" : "h-5 w-5",
          isFavorited && "fill-current"
        )}
      />
    </button>
  );
}
