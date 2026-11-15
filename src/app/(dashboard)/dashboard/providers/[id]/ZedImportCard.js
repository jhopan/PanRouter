"use client";

import { useCallback, useState } from "react";
import { Modal, Button, Card, Input } from "@/shared/components";
import { translate } from "@/i18n/runtime";

function candidateKey(candidate) {
  return `${candidate.service}|${candidate.account}|${candidate.fingerprint}`;
}

/**
 * Zed provider page: 2-step credential import.
 *
 * 1. POST /api/providers/zed/discover → fingerprints + account metadata only
 *    (the raw token never leaves the server).
 * 2. The user picks accounts; POST /api/providers/zed/import with the chosen
 *    `{ service, account, fingerprint }` triples. The server re-reads the
 *    keychain and imports only what still matches.
 *
 * The paste-a-callback-URL path covers Docker/headless installs where the host
 * keychain is unreachable.
 */
export default function ZedImportCard({ onImported }) {
  const [open, setOpen] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [skipped, setSkipped] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [manualBusy, setManualBusy] = useState(false);

  const discover = useCallback(async () => {
    setDiscovering(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/providers/zed/discover", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setCandidates([]);
        setSkipped([]);
        setSelected(new Set());
        setError(data.error || "Failed to discover Zed credentials");
        if (data.zedDockerEnvironment) setManualOpen(true);
        return;
      }
      const list = data.candidates || [];
      setCandidates(list);
      setSkipped(data.skipped || []);
      setSelected(new Set(list.map(candidateKey)));
      if (list.length === 0) {
        setNotice(
          "No importable Zed credentials were found in the OS keychain. Sign in to Zed, then re-scan.",
        );
      }
    } catch (err) {
      setCandidates([]);
      setError(err.message || "Failed to discover Zed credentials");
    } finally {
      setDiscovering(false);
    }
  }, []);

  const openAndDiscover = () => {
    setOpen(true);
    setManualUrl("");
    discover();
  };

  const toggleCandidate = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const importSelected = async () => {
    const confirmedAccounts = candidates
      .filter((candidate) => selected.has(candidateKey(candidate)))
      .map((candidate) => ({
        service: candidate.service,
        account: candidate.account,
        fingerprint: candidate.fingerprint,
      }));
    if (confirmedAccounts.length === 0) {
      setError("Select at least one account to import.");
      return;
    }

    setImporting(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/providers/zed/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedAccounts }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || "Failed to import credentials");
        return;
      }
      if (!data.count) {
        setNotice(
          "Nothing was imported: the keychain credential no longer matches what discovery showed. Re-scan and try again.",
        );
        await discover();
        return;
      }
      setOpen(false);
      await onImported?.();
      const failedCount = data.failed?.length || 0;
      alert(
        `Imported ${data.count} Zed credential(s)` +
          (failedCount ? `; ${failedCount} failed validation.` : "."),
      );
    } catch (err) {
      setError(err.message || "Failed to import credentials");
    } finally {
      setImporting(false);
    }
  };

  const importPastedUrl = async () => {
    const callbackUrl = manualUrl.trim();
    if (!callbackUrl) {
      setError("Paste the Zed callback URL first.");
      return;
    }
    setManualBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/providers/zed/manual-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callbackUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || "Failed to import the pasted callback URL");
        return;
      }
      setManualUrl("");
      setOpen(false);
      await onImported?.();
      alert("Zed session imported from the pasted callback URL.");
    } catch (err) {
      setError(err.message || "Failed to import the pasted callback URL");
    } finally {
      setManualBusy(false);
    }
  };

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{translate("Import from Zed IDE")}</h2>
            <p className="mt-1 text-sm text-text-muted">
              {translate(
                "Scan the OS keychain for a signed-in Zed session, review the accounts, then import only the ones you pick.",
              )}
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon="download"
            onClick={openAndDiscover}
            className="w-full sm:w-auto"
          >
            {translate("Scan Zed keychain")}
          </Button>
        </div>
      </Card>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={translate("Import from Zed IDE")}
        size="lg"
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {translate("Cancel")}
            </Button>
            <Button
              variant="secondary"
              icon={discovering ? "sync" : "refresh"}
              onClick={discover}
              disabled={discovering || importing}
            >
              {translate("Re-scan")}
            </Button>
            <Button
              icon="download"
              onClick={importSelected}
              disabled={discovering || importing || selected.size === 0}
            >
              {importing
                ? translate("Importing...")
                : `${translate("Import selected")} (${selected.size})`}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {discovering && (
            <p className="text-sm text-text-muted">{translate("Reading the OS keychain...")}</p>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {notice && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {notice}
            </div>
          )}

          {!discovering && candidates.length > 0 && (
            <div className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
              {candidates.map((candidate) => {
                const key = candidateKey(candidate);
                return (
                  <label
                    key={key}
                    className="flex cursor-pointer items-start gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 accent-primary"
                      checked={selected.has(key)}
                      onChange={() => toggleCandidate(key)}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {candidate.provider} · {candidate.account}
                      </div>
                      <div className="break-all text-xs text-text-muted">{candidate.service}</div>
                      <div className="break-all font-mono text-[11px] text-text-muted">
                        fp {candidate.fingerprint}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {!discovering && skipped.length > 0 && (
            <p className="text-xs text-text-muted">
              {translate("Skipped")}: {skipped.length} (
              {skipped.map((entry) => entry.reason).filter(Boolean).join(", ")})
            </p>
          )}

          <div className="border-t border-black/5 pt-3 dark:border-white/10">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left text-sm font-medium"
              onClick={() => setManualOpen((value) => !value)}
              aria-expanded={manualOpen}
            >
              <span>{translate("Paste callback URL instead (Docker / headless)")}</span>
              <span className="material-symbols-outlined text-base text-text-muted">
                {manualOpen ? "expand_less" : "expand_more"}
              </span>
            </button>
            {manualOpen && (
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-xs text-text-muted">
                  {translate(
                    "Use this when the keychain is unreachable. Paste the full redirect URL from the Zed sign-in tab; it only works while the sign-in flow is still open on this server.",
                  )}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    className="flex-1"
                    placeholder="http://127.0.0.1:58443/?user_id=...&access_token=..."
                    value={manualUrl}
                    onChange={(event) => setManualUrl(event.target.value)}
                    aria-label={translate("Zed callback URL")}
                  />
                  <Button
                    variant="secondary"
                    icon="upload"
                    onClick={importPastedUrl}
                    disabled={manualBusy || !manualUrl.trim()}
                  >
                    {manualBusy ? translate("Saving...") : translate("Import URL")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}