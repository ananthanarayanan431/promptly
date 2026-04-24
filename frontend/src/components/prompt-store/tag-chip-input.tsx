"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";

interface TagChipInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  max?: number;
  placeholder?: string;
}

export function TagChipInput({
  value,
  onChange,
  suggestions = [],
  max = 10,
  placeholder = "Add tag…",
}: TagChipInputProps) {
  const [inputVal, setInputVal] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = suggestions.filter(
    (s) =>
      s.toLowerCase().startsWith(inputVal.toLowerCase()) &&
      !value.includes(s)
  );

  function addTag(tag: string) {
    const t = tag.trim().slice(0, 30);
    if (!t || value.includes(t) || value.length >= max) return;
    onChange([...value, t]);
    setInputVal("");
    setOpen(false);
  }

  function removeTag(tag: string) {
    onChange(value.filter((v) => v !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputVal);
    } else if (e.key === "Backspace" && inputVal === "") {
      removeTag(value[value.length - 1]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const atMax = value.length >= max;

  return (
    <div style={{ position: "relative" }}>
      <div
        onClick={() => inputRef.current?.focus()}
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: "6px 10px",
          minHeight: 38,
          borderRadius: 8,
          border: "1px solid #2a2a2e",
          background: "#1a1a1a",
          cursor: "text",
          alignItems: "center",
        }}
      >
        {value.map((tag) => (
          <span
            key={tag}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 999,
              background: "rgba(124,92,255,0.12)",
              border: "1px solid rgba(124,92,255,0.25)",
              color: "#7c5cff",
              fontSize: 12,
              fontFamily: "var(--font-geist-mono, monospace)",
            }}
          >
            {tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "rgba(124,92,255,0.6)",
              }}
            >
              <X style={{ width: 10, height: 10 }} />
            </button>
          </span>
        ))}
        {!atMax && (
          <input
            ref={inputRef}
            value={inputVal}
            onChange={(e) => { setInputVal(e.target.value); setOpen(true); }}
            onKeyDown={handleKeyDown}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={value.length === 0 ? placeholder : ""}
            style={{
              flex: 1,
              minWidth: 80,
              background: "none",
              border: "none",
              outline: "none",
              fontSize: 13,
              color: "#ededed",
              fontFamily: "var(--font-geist, ui-sans-serif)",
              padding: 0,
            }}
          />
        )}
      </div>

      {open && inputVal.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "#1a1a1a",
            border: "1px solid #2a2a2e",
            borderRadius: 8,
            overflow: "hidden",
            zIndex: 50,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          {filtered.length > 0
            ? filtered.slice(0, 8).map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); addTag(s); }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                    color: "#ededed",
                    fontFamily: "var(--font-geist, ui-sans-serif)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(124,92,255,0.08)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                >
                  {s}
                </button>
              ))
            : (
              <div style={{ padding: "8px 12px", fontSize: 12, color: "#5a5a60",
                fontFamily: "var(--font-geist, ui-sans-serif)" }}>
                Press Enter to add &ldquo;{inputVal}&rdquo;
              </div>
            )}
        </div>
      )}
    </div>
  );
}
