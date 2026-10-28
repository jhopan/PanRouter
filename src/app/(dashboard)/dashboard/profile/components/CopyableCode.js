"use client";

import { useState } from "react";
import PropTypes from "prop-types";

/**
 * A code block with a copy button.
 *
 * The command text is rendered with real line breaks (pre-wrap) and copied
 * verbatim — the clipboard gets the same thing the reader sees, so it can be
 * pasted straight into a shell.
 */
export default function CopyableCode({ label, code, hint }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the text is selectable anyway */
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {label ? <p className="text-xs font-semibold text-text-muted">{label}</p> : null}
      <div className="flex items-stretch gap-2">
        <pre className="flex-1 min-w-0 overflow-x-auto rounded bg-surface-2 p-2 text-xs font-mono text-text-main whitespace-pre-wrap break-words">
          {code}
        </pre>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy to clipboard"
          title="Copy to clipboard"
          className="flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-lg border border-border text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
        >
          <span className="material-symbols-outlined text-[16px]">
            {copied ? "check" : "content_copy"}
          </span>
        </button>
      </div>
      {hint ? <p className="text-[11px] text-text-muted/80">{hint}</p> : null}
    </div>
  );
}

CopyableCode.propTypes = {
  label: PropTypes.string,
  code: PropTypes.string.isRequired,
  hint: PropTypes.string,
};
