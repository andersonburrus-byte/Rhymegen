interface PatternDisplayProps {
  pattern: string;
  syllables: number;
}

export function PatternDisplay({ pattern, syllables }: PatternDisplayProps) {
  return (
    <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
      <span className="font-mono tracking-wide">{pattern}</span>
      <span className="text-zinc-300 dark:text-zinc-600">·</span>
      <span>{syllables} syllable{syllables !== 1 ? "s" : ""}</span>
    </div>
  );
}
