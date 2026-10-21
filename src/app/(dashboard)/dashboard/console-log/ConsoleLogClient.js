"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Card, Button } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

const LOG_LEVEL_COLORS = {
  LOG: "text-green-400",
  INFO: "text-blue-400",
  WARN: "text-yellow-400",
  ERROR: "text-red-400",
  DEBUG: "text-purple-400",
};

// Tags that are pure background noise: they fire on every token-refresh tick
// and bury the request lines you actually want to read.
const NOISY_TAGS = ["TOKEN_REFRESH", "BG_TOKEN_REFRESH"];

function colorLine(line) {
  const match = line.match(/\[(\w+)\]/g);
  const levelTag = match ? match[1]?.replace(/[|]/g, "") : null;
  const color = LOG_LEVEL_COLORS[levelTag] || "text-green-400";
  return <span className={color}>{line}</span>;
}

/** Pull the bracketed tag out of a log line: "[09:01:54] ℹ️  [TOKEN_REFRESH] ..." */
function tagOf(line) {
  const m = String(line).match(/\]\s*[^\[]*\[([A-Z_]+)\]/);
  return m ? m[1] : "";
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hideNoise, setHideNoise] = useState(true);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const logRef = useRef(null);
  // While paused we keep buffering here so resuming loses nothing.
  const bufferRef = useRef([]);
  const pausedRef = useRef(false);

  const handleClear = async () => {
    try {
      await fetch("/api/translator/console-logs", { method: "DELETE" });
      bufferRef.current = [];
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  const appendLines = useCallback((incoming) => {
    if (!incoming?.length) return;
    if (pausedRef.current) {
      bufferRef.current = [...bufferRef.current, ...incoming].slice(-CONSOLE_LOG_CONFIG.maxLines);
      return;
    }
    setLogs((prev) => {
      const next = [...prev, ...incoming];
      return next.length > CONSOLE_LOG_CONFIG.maxLines
        ? next.slice(-CONSOLE_LOG_CONFIG.maxLines)
        : next;
    });
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/translator/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
      } else if (msg.type === "line") {
        appendLines([msg.line]);
      } else if (msg.type === "lines") {
        appendLines(msg.lines);
      } else if (msg.type === "clear") {
        setLogs([]);
        bufferRef.current = [];
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, [appendLines]);

  // Mirror `paused` into a ref so the SSE handler (bound once) sees the current
  // value, and flush whatever buffered while we were paused.
  useEffect(() => {
    pausedRef.current = paused;
    if (!paused && bufferRef.current.length) {
      const pending = bufferRef.current;
      bufferRef.current = [];
      setLogs((prev) => {
        const next = [...prev, ...pending];
        return next.length > CONSOLE_LOG_CONFIG.maxLines
          ? next.slice(-CONSOLE_LOG_CONFIG.maxLines)
          : next;
      });
    }
  }, [paused]);

  const allTags = useMemo(() => {
    const set = new Set();
    for (const line of logs) {
      const t = tagOf(line);
      if (t) set.add(t);
    }
    return [...set].sort();
  }, [logs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((line) => {
      const t = tagOf(line);
      if (hideNoise && NOISY_TAGS.includes(t)) return false;
      if (tagFilter && t !== tagFilter) return false;
      if (q && !line.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, hideNoise, tagFilter, query]);

  // Auto-scroll only while live — pausing should freeze the view.
  useEffect(() => {
    if (paused || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [visible, paused]);

  const hiddenCount = logs.length - visible.length;

  return (
    <div className="">
      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
              connected ? "bg-green-500/15 text-green-500" : "bg-red-500/15 text-red-500"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
            {connected ? "live" : "disconnected"}
          </span>

          <Button
            size="sm"
            variant={paused ? "primary" : "outline"}
            icon={paused ? "play_arrow" : "pause"}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? "Resume" : "Pause"}
          </Button>

          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={hideNoise}
              onChange={(e) => setHideNoise(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300"
            />
            Hide refresh logs
          </label>

          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
          >
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter text…"
            className="w-40 rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
          />

          <span className="text-[11px] text-text-muted">
            {visible.length} shown
            {hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}
          </span>

          <div className="ml-auto">
            <Button size="sm" variant="outline" icon="delete" onClick={handleClear}>
              Clear
            </Button>
          </div>
        </div>
        <div
          ref={logRef}
          className="bg-black rounded-b-lg p-4 text-xs font-mono h-[calc(100vh-260px)] overflow-y-auto"
        >
          {visible.length === 0 ? (
            <span className="text-text-muted">
              {logs.length === 0 ? "No console logs yet." : "All lines filtered out."}
            </span>
          ) : (
            <div className="space-y-0.5">
              {visible.map((line, i) => (
                <div key={i}>{colorLine(line)}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
