"use client";
import { useRef } from "react";
import { Search, X } from "lucide-react";
import { clsx } from "clsx";

interface InputZoneProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  loading: boolean;
}

export function InputZone({ value, onChange, onSubmit, onClear, loading }: InputZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
    if (e.key === "Escape") {
      onClear();
    }
  };

  return (
    <div className="w-full">
      <div className="relative flex items-center">
        <Search
          size={18}
          strokeWidth={1.5}
          className="absolute left-4 text-zinc-400 dark:text-zinc-500 pointer-events-none"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter a phrase to rhyme…"
          aria-label="Phrase to find rhymes for"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className={clsx(
            "w-full rounded-xl border bg-white dark:bg-zinc-900",
            "border-zinc-200 dark:border-zinc-700",
            "pl-11 pr-20 py-3.5 text-base",
            "text-zinc-900 dark:text-zinc-100",
            "placeholder:text-zinc-400 dark:placeholder:text-zinc-500",
            "focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100",
            "transition-shadow"
          )}
        />
        <div className="absolute right-2 flex items-center gap-1">
          {value && (
            <button
              onClick={onClear}
              aria-label="Clear input"
              className="rounded-lg p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-400"
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          )}
          <button
            onClick={onSubmit}
            disabled={loading || !value.trim()}
            aria-label="Find rhymes"
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-400",
              "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
              "hover:bg-zinc-700 dark:hover:bg-zinc-300",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            {loading ? "…" : "Go"}
          </button>
        </div>
      </div>
    </div>
  );
}
