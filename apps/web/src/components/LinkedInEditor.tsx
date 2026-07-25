import { useRef, useState } from 'react';
import { STYLES, stripListMarker, type StyleName } from '../lib/linkedinFormat';
import { Button, cx } from './ui';

interface Props {
  value: string;
  onChange: (next: string) => void;
  limit: number;
}

const STYLE_BUTTONS: Array<{ style: StyleName; label: string; title: string }> = [
  { style: 'bold', label: '𝗕', title: 'Bold' },
  { style: 'italic', label: '𝘐', title: 'Italic' },
  { style: 'boldItalic', label: '𝘽', title: 'Bold italic' },
  { style: 'underline', label: 'U̲', title: 'Underline' },
  { style: 'strike', label: 'S̶', title: 'Strikethrough' },
  { style: 'mono', label: '𝙼', title: 'Monospace' },
];

const EMOJIS = ['📈', '💼', '🏛️', '⚖️', '🌍', '🔑', '📊', '💡', '✅', '➡️', '⭐', '🔗'];

export function LinkedInEditor({ value, onChange, limit }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);

  /** Runs a transform over the current selection and restores the caret. */
  const edit = (fn: (sel: string, whole: string, start: number, end: number) => { text: string; from: number; to: number }) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const result = fn(value.slice(start, end), value, start, end);
    onChange(result.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(result.from, result.to);
    });
  };

  const applyStyle = (style: StyleName) =>
    edit((sel, whole, start, end) => {
      if (!sel) return { text: whole, from: start, to: end };
      const styled = STYLES[style](sel);
      return { text: whole.slice(0, start) + styled + whole.slice(end), from: start, to: start + styled.length };
    });

  const applyLinePrefix = (make: (index: number) => string) =>
    edit((_sel, whole, start, end) => {
      const lineStart = whole.lastIndexOf('\n', start - 1) + 1;
      const nextBreak = whole.indexOf('\n', end);
      const lineEnd = nextBreak === -1 ? whole.length : nextBreak;
      const lines = whole.slice(lineStart, lineEnd).split('\n');
      const rebuilt = lines
        .map((line, index) => (line.trim() ? make(index) + stripListMarker(line) : line))
        .join('\n');
      return { text: whole.slice(0, lineStart) + rebuilt + whole.slice(lineEnd), from: lineStart, to: lineStart + rebuilt.length };
    });

  const insert = (str: string) =>
    edit((_sel, whole, start, end) => ({
      text: whole.slice(0, start) + str + whole.slice(end),
      from: start + str.length,
      to: start + str.length,
    }));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      ref.current?.select();
    }
  };

  const over = value.length > limit;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b border-stone-100 bg-stone-50/70 px-2.5 py-1.5">
        {STYLE_BUTTONS.map((button) => (
          <button
            key={button.style}
            title={button.title}
            onClick={() => applyStyle(button.style)}
            className="grid h-7 w-7 place-items-center rounded-md text-[13px] text-stone-700 transition-colors hover:bg-white hover:text-teal-700 hover:shadow-sm"
          >
            {button.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-stone-200" />
        <button
          title="Bulleted list"
          onClick={() => applyLinePrefix(() => '• ')}
          className="grid h-7 w-7 place-items-center rounded-md text-[13px] text-stone-700 transition-colors hover:bg-white hover:text-teal-700 hover:shadow-sm"
        >
          •
        </button>
        <button
          title="Numbered list"
          onClick={() => applyLinePrefix((index) => `${index + 1}. `)}
          className="grid h-7 w-7 place-items-center rounded-md text-[12px] font-medium text-stone-700 transition-colors hover:bg-white hover:text-teal-700 hover:shadow-sm"
        >
          1.
        </button>
        <button
          title="Checklist"
          onClick={() => applyLinePrefix(() => '✅ ')}
          className="grid h-7 w-7 place-items-center rounded-md text-[13px] transition-colors hover:bg-white hover:shadow-sm"
        >
          ✅
        </button>
        <span className="mx-1 h-4 w-px bg-stone-200" />
        <div className="flex flex-wrap items-center gap-0.5">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              title={`Insert ${emoji}`}
              onClick={() => insert(emoji)}
              className="grid h-7 w-7 place-items-center rounded-md text-[13px] transition-colors hover:bg-white hover:shadow-sm"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <textarea
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={14}
        spellCheck={false}
        className="w-full resize-y bg-white px-4 py-3.5 text-[13.5px] leading-relaxed text-stone-800 outline-none"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 px-4 py-2.5">
        <span className={cx('text-[11.5px]', over ? 'text-red-600' : 'text-stone-500')}>
          {value.length} / {limit} characters &middot; select text, then a style. Hook stays above the ~210-char
          &ldquo;see more&rdquo; fold.
        </span>
        <Button size="sm" variant="primary" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy post'}
        </Button>
      </div>
    </div>
  );
}
