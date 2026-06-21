"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-right"
      className="toaster group"
      gap={8}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info:    <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error:   <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          // Normal toasts
          "--normal-bg":     "var(--surface)",
          "--normal-text":   "var(--text)",
          "--normal-border": "var(--border)",

          // Error toasts — use the app's danger colour
          "--error-bg":      "color-mix(in oklab, var(--danger) 10%, var(--surface))",
          "--error-text":    "var(--danger)",
          "--error-border":  "color-mix(in oklab, var(--danger) 30%, transparent)",

          // Success toasts
          "--success-bg":    "color-mix(in oklab, var(--success) 10%, var(--surface))",
          "--success-text":  "var(--success)",
          "--success-border":"color-mix(in oklab, var(--success) 30%, transparent)",

          "--border-radius": "10px",
          "--toast-width":   "360px",
        } as React.CSSProperties
      }
      toastOptions={{
        style: {
          fontFamily: "var(--sans, ui-sans-serif)",
          fontSize:   "13px",
          boxShadow:  "0 4px 20px rgba(0,0,0,.15)",
        },
        classNames: {
          toast:       "cn-toast",
          error:       "cn-toast-error",
          description: "cn-toast-desc",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
