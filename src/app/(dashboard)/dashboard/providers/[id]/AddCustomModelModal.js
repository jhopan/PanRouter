"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Modal, Select, Toggle } from "@/shared/components";
import { CAPACITY_META, STT_TRANSPORT_META, STT_TRANSPORTS } from "@/shared/constants/models";

const defaultCaps = () => Object.fromEntries(Object.keys(CAPACITY_META).map((key) => [key, false]));

// Model type is stored on the custom-model record (/api/models/custom POST
// `type`), which is what the dispatcher and the per-kind model lists read.
const MODEL_TYPES = [
  { value: "llm", label: "Chat / LLM" },
  { value: "image", label: "Image generation" },
  { value: "tts", label: "Text to speech (TTS)" },
  { value: "stt", label: "Speech to text (STT)" },
  { value: "embedding", label: "Embeddings" },
];

const MODEL_TYPE_HINT = {
  llm: "Chat models appear in this provider's Available Models.",
  image: "Image models are called via /v1/images/generations.",
  tts: "Speech models are called via /v1/audio/speech.",
  stt: "Transcription models are called via /v1/audio/transcriptions.",
  embedding: "Embedding models are called via /v1/embeddings.",
};

export default function AddCustomModelModal({ isOpen, providerAlias, providerDisplayAlias, onSave, onClose }) {
  const [modelId, setModelId] = useState("");
  const [caps, setCaps] = useState(defaultCaps);
  const [modelType, setModelType] = useState("llm");
  const [testStatus, setTestStatus] = useState(null); // null | "testing" | "ok" | "error"
  const [testError, setTestError] = useState("");
  const [fullTesting, setFullTesting] = useState(false);
  const [fullResult, setFullResult] = useState(null); // { caps, detail } from detect-caps
  const [saving, setSaving] = useState(false);
  // Realtime dispatch marker for the transport select; "" = provider default REST.
  const [transport, setTransport] = useState("");

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) { setModelId(""); setCaps(defaultCaps()); setModelType("llm"); setTransport(""); setTestStatus(null); setTestError(""); setFullResult(null); }
  }, [isOpen]);

  // Strip provider's own alias prefix (e.g. "cc/model" -> "model" for cc provider)
  const stripAlias = (id) => {
    const prefix = `${providerAlias}/`;
    return id.startsWith(prefix) ? id.slice(prefix.length) : id;
  };

  const handleTest = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId) return;
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${cleanId}`, kind: modelType }),
      });
      const data = await res.json();
      setTestStatus(data.ok ? "ok" : "error");
      setTestError(data.error || "");
    } catch (err) {
      setTestStatus("error");
      setTestError(err.message);
    }
  };

  // Test Full: probe the model for vision/reasoning and auto-apply to the toggles.
  const handleTestFull = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId || fullTesting) return;
    setFullTesting(true);
    setFullResult(null);
    try {
      const res = await fetch("/api/models/detect-caps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${cleanId}` }),
      });
      const data = await res.json();
      if (data.caps) {
        // Auto-apply detected caps to the toggles (user can still override).
        setCaps((prev) => ({ ...prev, vision: !!data.caps.vision, reasoning: !!data.caps.reasoning }));
        setFullResult(data);
      } else {
        setTestStatus("error");
        setTestError(data.error || "detect failed");
      }
    } catch (err) {
      setTestStatus("error");
      setTestError(err.message);
    } finally {
      setFullTesting(false);
    }
  };

  const handleSave = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId || saving) return;
    setSaving(true);
    try {
      await onSave(cleanId, modelType, modelType === "llm" ? caps : undefined, modelType === "stt" ? transport : null);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleTest();
  };

  // Capabilities are chat-only probes, so switching types drops them.
  const handleTypeChange = (e) => {
    setModelType(e.target.value);
    setCaps(defaultCaps());
    setTransport("");
    setTestStatus(null);
    setTestError("");
    setFullResult(null);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Custom Model">
      <div className="flex flex-col gap-4">
        <Select
          label="Model type"
          value={modelType}
          options={MODEL_TYPES}
          onChange={handleTypeChange}
          disabled={saving || testStatus === "testing"}
          hint={MODEL_TYPE_HINT[modelType]}
        />
        <div>
          <label className="text-sm font-medium mb-1.5 block">Model ID</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={modelId}
              onChange={(e) => { setModelId(e.target.value); setTestStatus(null); setTestError(""); }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. claude-opus-4-5"
              className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              autoFocus
            />
            <Button
              variant="secondary"
              icon="science"
              loading={testStatus === "testing"}
              onClick={handleTest}
              disabled={!modelId.trim() || testStatus === "testing"}
            >
              {testStatus === "testing" ? "Testing..." : "Test"}
            </Button>
            {modelType === "llm" && (
              <Button
                variant="secondary"
                icon="troubleshoot"
                loading={fullTesting}
                onClick={handleTestFull}
                disabled={!modelId.trim() || fullTesting}
              >
                {fullTesting ? "Detecting..." : "Test Full"}
              </Button>
            )}
          </div>
          <p className="text-xs text-text-muted mt-1">
            Sent to provider as: <code className="font-mono bg-sidebar px-1 rounded">{stripAlias(modelId.trim()) || "model-id"}</code>
          </p>
        </div>

        {modelType === "llm" && (
          <div>
            <label className="text-sm font-medium mb-1.5 block">Capabilities</label>
            <div className="flex flex-wrap gap-4">
              {Object.entries(CAPACITY_META).map(([key, meta]) => (
                <Toggle
                  key={key}
                  checked={!!caps[key]}
                  onChange={(v) => setCaps((prev) => ({ ...prev, [key]: v }))}
                  label={meta.label}
                  description={meta.desc}
                  size="sm"
                />
              ))}
            </div>
          </div>
        )}

        {modelType === "stt" && (
          <Select
            label="Transport"
            value={transport}
            onChange={(e) => setTransport(e.target.value)}
            placeholder="Provider default (REST)"
            options={STT_TRANSPORTS.map((t) => ({ value: t, label: STT_TRANSPORT_META[t].label }))}
            hint="Realtime transport marker for the STT dispatcher. Empty keeps the provider's REST format."
          />
        )}

        {/* Test Full result */}
        {fullResult && (
          <div className="bg-sidebar/50 border border-accent/20 rounded-lg p-3 text-xs flex flex-col gap-1">
            <span className="font-medium">Detected capabilities (auto-applied):</span>
            <span>Vision: <b>{fullResult.caps.vision ? "YES" : "no"}</b> — {fullResult.detail.vision}</span>
            <span>Reasoning: <b>{fullResult.caps.reasoning ? "YES" : "no"}</b> — {fullResult.detail.reasoning}</span>
            {fullResult.detail.contextWindow ? (
              <span className="text-text-muted">Context: ~{fullResult.detail.contextWindow.toLocaleString()} tokens{fullResult.detail.thinkingFormat ? ` · thinking: ${fullResult.detail.thinkingFormat}` : ""}</span>
            ) : null}
          </div>
        )}

        {/* Test result */}
        {testStatus === "ok" && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <span className="material-symbols-outlined text-base">check_circle</span>
            Model is reachable
          </div>
        )}
        {testStatus === "error" && (
          <div className="flex items-start gap-2 text-sm text-red-500">
            <span className="material-symbols-outlined text-base shrink-0">cancel</span>
            <span>{testError || "Model not reachable"}</span>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button onClick={onClose} variant="ghost" fullWidth size="sm">Cancel</Button>
          <Button
            onClick={handleSave}
            fullWidth
            size="sm"
            disabled={!modelId.trim() || saving}
          >
            {saving ? "Adding..." : "Add Model"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
