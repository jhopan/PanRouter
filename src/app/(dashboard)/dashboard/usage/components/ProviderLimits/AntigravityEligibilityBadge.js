"use client";

import PropTypes from "prop-types";
import Tooltip from "@/shared/components/Tooltip";

/**
 * Antigravity account-eligibility badge.
 *
 * Google can flag an account as ineligible and require a browser
 * re-verification (reasonCode "VALIDATION_REQUIRED"). The account refuses every
 * model until it is verified, so the operator needs to see it at a glance and
 * get the verification link without hunting through the logs.
 *
 * The link is copied with one click (it is long and single-use) and can also be
 * opened directly.
 */
export default function AntigravityEligibilityBadge({ ineligible, onCopy, copied }) {
  if (!ineligible || ineligible.eligible !== false) return null;

  const reasonCode = ineligible.reasonCode || "VALIDATION_REQUIRED";
  const validationUrl = ineligible.validationUrl || null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <Tooltip text={`Google flagged this account (${reasonCode}). It refuses every model until it is verified in a browser.`}>
        <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-600 dark:text-orange-400">
          <span className="material-symbols-outlined text-[12px]">gpp_maybe</span>
          Needs verification
        </span>
      </Tooltip>

      {validationUrl ? (
        <>
          <Tooltip text="Copy the verification link">
            <button
              type="button"
              onClick={() => onCopy?.(validationUrl)}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border-subtle px-2 py-0.5 text-[10px] text-text-muted transition-colors hover:text-primary"
            >
              <span className="material-symbols-outlined text-[12px]">
                {copied ? "check" : "content_copy"}
              </span>
              <code className="truncate font-mono">Copy verify link</code>
            </button>
          </Tooltip>
          <Tooltip text="Open the verification link in a new tab">
            <a
              href={validationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-2 py-0.5 text-[10px] text-text-muted transition-colors hover:text-primary"
            >
              <span className="material-symbols-outlined text-[12px]">open_in_new</span>
              Verify
            </a>
          </Tooltip>
        </>
      ) : null}
    </div>
  );
}

AntigravityEligibilityBadge.propTypes = {
  ineligible: PropTypes.shape({
    eligible: PropTypes.bool,
    reasonCode: PropTypes.string,
    validationUrl: PropTypes.string,
  }),
  onCopy: PropTypes.func,
  copied: PropTypes.bool,
};
