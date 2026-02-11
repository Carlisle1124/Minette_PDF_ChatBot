/**
 * use-model-downloads.ts
 * ======================
 * React hook for managing model downloads with real-time progress.
 *
 * Usage:
 *   const { downloads, startDownload, cancelDownload, isDownloading } = useModelDownloads();
 *
 *   // Start an Ollama download
 *   startDownload({ source: "ollama", model_name: "llama3.2:1b" });
 *
 *   // Start a HuggingFace download
 *   startDownload({ source: "huggingface", repo_id: "TheBloke/...", filename: "model.gguf" });
 *
 *   // Cancel
 *   cancelDownload(taskId);
 *
 *   // Check progress
 *   downloads.forEach(d => console.log(d.progress_percent));
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  startModelDownload,
  getDownloadProgress,
  cancelDownload as apiCancelDownload,
  getDownloadQueue,
  type DownloadProgress,
  type DownloadRequest,
} from "@/lib/api";

export interface UseModelDownloadsReturn {
  /** All tracked downloads (active, completed, failed). */
  downloads: DownloadProgress[];
  /** Start a new download. Returns task_id on success, null on error. */
  startDownload: (req: DownloadRequest) => Promise<string | null>;
  /** Cancel a running download. */
  cancelDownload: (taskId: string) => Promise<boolean>;
  /** True if any download is queued/downloading/verifying. */
  isDownloading: boolean;
  /** Last error message. */
  error: string | null;
  /** Refresh from server (e.g. on mount). */
  refreshQueue: () => Promise<void>;
  /** Remove a completed/failed download from the local list. */
  dismiss: (taskId: string) => void;
}

const POLL_INTERVAL_MS = 800;

export function useModelDownloads(): UseModelDownloadsReturn {
  const [downloads, setDownloads] = useState<DownloadProgress[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Track active task IDs that need polling
  const pollingRef = useRef<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Polling loop
  const startPolling = useCallback(() => {
    if (intervalRef.current) return; // already polling
    intervalRef.current = setInterval(async () => {
      const activeIds = Array.from(pollingRef.current);
      if (activeIds.length === 0) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }

      const updated: DownloadProgress[] = [];
      for (const tid of activeIds) {
        try {
          const p = await getDownloadProgress(tid);
          updated.push(p);
          // Stop polling finished tasks
          if (["completed", "failed", "cancelled"].includes(p.state)) {
            pollingRef.current.delete(tid);
          }
        } catch {
          pollingRef.current.delete(tid);
        }
      }

      if (updated.length > 0) {
        setDownloads((prev) => {
          const map = new Map(prev.map((d) => [d.task_id, d]));
          for (const u of updated) map.set(u.task_id, u);
          return Array.from(map.values());
        });
      }

      // Stop interval if nothing left
      if (pollingRef.current.size === 0 && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, POLL_INTERVAL_MS);
  }, []);

  const startDownload = useCallback(
    async (req: DownloadRequest): Promise<string | null> => {
      setError(null);
      try {
        const result = await startModelDownload(req);
        const taskId = result.task_id;

        // Add an initial entry
        const initial: DownloadProgress = {
          task_id: taskId,
          state: "queued",
          progress_percent: 0,
          downloaded_bytes: 0,
          total_bytes: 0,
          speed_bps: 0,
          eta_seconds: 0,
          error: null,
          attempt: 0,
          max_retries: 3,
          filename: req.model_name || req.filename || "",
          model_id: result.model_id,
          source: result.source,
        };
        setDownloads((prev) => [...prev, initial]);

        // Start polling for this task
        pollingRef.current.add(taskId);
        startPolling();

        return taskId;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Download start failed";
        setError(msg);
        return null;
      }
    },
    [startPolling],
  );

  const cancelDownloadTask = useCallback(async (taskId: string): Promise<boolean> => {
    try {
      await apiCancelDownload(taskId);
      pollingRef.current.delete(taskId);
      setDownloads((prev) =>
        prev.map((d) =>
          d.task_id === taskId ? { ...d, state: "cancelled" as const } : d,
        ),
      );
      return true;
    } catch {
      return false;
    }
  }, []);

  const refreshQueue = useCallback(async () => {
    try {
      const { downloads: queue } = await getDownloadQueue();
      setDownloads(queue);
      // Resume polling for active tasks
      for (const d of queue) {
        if (["queued", "downloading", "verifying"].includes(d.state)) {
          pollingRef.current.add(d.task_id);
        }
      }
      if (pollingRef.current.size > 0) startPolling();
    } catch {
      // ignore — queue endpoint might not have tasks
    }
  }, [startPolling]);

  const dismiss = useCallback((taskId: string) => {
    pollingRef.current.delete(taskId);
    setDownloads((prev) => prev.filter((d) => d.task_id !== taskId));
  }, []);

  const isDownloading = downloads.some((d) =>
    ["queued", "downloading", "verifying"].includes(d.state),
  );

  return {
    downloads,
    startDownload,
    cancelDownload: cancelDownloadTask,
    isDownloading,
    error,
    refreshQueue,
    dismiss,
  };
}
