import { useState, useEffect, useCallback } from "react";
import {
  Download,
  Trash2,
  Check,
  Loader2,
  HardDrive,
  X,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  getPulledModels,
  startModelDownload,
  getDownloadProgress,
  deleteModel,
  type PulledModel,
  type DownloadProgress,
} from "@/lib/api";
import { AVAILABLE_MODELS } from "@/lib/settingsStorage";

interface ModelWithStatus {
  id: string;
  name: string;
  size: string;
  description: string;
  pulled: boolean;
}

interface ActiveDownload {
  taskId: string;
  modelId: string;
  progress: DownloadProgress | null;
}

const POLL_INTERVAL = 800;

export function ModelManager() {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelWithStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeDownloads, setActiveDownloads] = useState<Map<string, ActiveDownload>>(new Map());
  const [deletingModels, setDeletingModels] = useState<Set<string>>(new Set());

  const refreshModels = useCallback(async () => {
    setLoading(true);
    try {
      const { models: pulled } = await getPulledModels();
      const pulledNames = new Set(pulled.map((m) => m.name));

      // Also add base names (without tag) for matching
      pulled.forEach((m) => {
        const base = m.name.split(":")[0];
        pulledNames.add(base);
      });

      const merged: ModelWithStatus[] = AVAILABLE_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        size: m.size,
        description: m.description,
        pulled: pulledNames.has(m.id) || pulledNames.has(m.id.split(":")[0]),
      }));

      setModels(merged);
    } catch (err) {
      console.error("Failed to refresh models:", err);
      // Still show the list but mark none as pulled
      const merged: ModelWithStatus[] = AVAILABLE_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        size: m.size,
        description: m.description,
        pulled: false,
      }));
      setModels(merged);
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh on open
  useEffect(() => {
    if (open) {
      refreshModels();
    }
  }, [open, refreshModels]);

  // Poll active downloads
  useEffect(() => {
    if (activeDownloads.size === 0) return;

    const interval = setInterval(async () => {
      const updated = new Map(activeDownloads);
      let changed = false;

      for (const [modelId, dl] of updated.entries()) {
        try {
          const progress = await getDownloadProgress(dl.taskId);
          updated.set(modelId, { ...dl, progress });

          if (["completed", "failed", "cancelled"].includes(progress.state)) {
            if (progress.state === "completed") {
              toast.success(`${modelId} downloaded successfully!`);
              // Refresh model list to update pulled status
              refreshModels();
            } else if (progress.state === "failed") {
              toast.error(`Download of ${modelId} failed: ${progress.error || "Unknown error"}`);
            }
            updated.delete(modelId);
            changed = true;
          }
        } catch {
          updated.delete(modelId);
          changed = true;
        }
      }

      setActiveDownloads(updated);
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [activeDownloads, refreshModels]);

  const handleDownload = async (modelId: string) => {
    try {
      const result = await startModelDownload({
        source: "ollama",
        model_name: modelId,
      });

      setActiveDownloads((prev) => {
        const next = new Map(prev);
        next.set(modelId, {
          taskId: result.task_id,
          modelId,
          progress: null,
        });
        return next;
      });

      toast.info(`Downloading ${modelId}...`);
    } catch (err) {
      toast.error(`Failed to start download: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleDelete = async (modelId: string) => {
    setDeletingModels((prev) => new Set(prev).add(modelId));
    try {
      await deleteModel(modelId);
      toast.success(`${modelId} deleted`);
      refreshModels();
    } catch (err) {
      toast.error(`Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeletingModels((prev) => {
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
    }
  };

  const getDownloadInfo = (modelId: string): ActiveDownload | undefined => {
    return activeDownloads.get(modelId);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <HardDrive className="h-4 w-4" />
          Models
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[550px] max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Model Manager
          </DialogTitle>
          <DialogDescription>
            Download and manage AI models. Models are pulled via Ollama.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {models.filter((m) => m.pulled).length} of {models.length} models installed
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={refreshModels}
            disabled={loading}
            className="h-7 gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <Separator />

        <ScrollArea className="max-h-[55vh] pr-3">
          <div className="space-y-2">
            {models.map((model) => {
              const dl = getDownloadInfo(model.id);
              const isDownloading = !!dl;
              const isDeleting = deletingModels.has(model.id);

              return (
                <div
                  key={model.id}
                  className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-sm truncate">
                        {model.name}
                      </span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                        {model.size}
                      </Badge>
                      {model.pulled && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0 gap-1 shrink-0 bg-green-600 hover:bg-green-700">
                          <Check className="h-2.5 w-2.5" />
                          Installed
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{model.description}</p>
                    <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">{model.id}</p>

                    {/* Download progress bar */}
                    {isDownloading && dl?.progress && (
                      <div className="mt-2 space-y-1">
                        <Progress value={dl.progress.progress_percent} className="h-1.5" />
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>
                            {dl.progress.state === "downloading"
                              ? `${dl.progress.progress_percent.toFixed(1)}%`
                              : dl.progress.state}
                          </span>
                          {dl.progress.speed_bps > 0 && (
                            <span>
                              {(dl.progress.speed_bps / 1024 / 1024).toFixed(1)} MB/s
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    {isDownloading && !dl?.progress && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Starting download...
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="shrink-0 flex items-center gap-1.5 pt-0.5">
                    {!model.pulled && !isDownloading && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownload(model.id)}
                        className="h-7 gap-1.5 text-xs"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Pull
                      </Button>
                    )}
                    {isDownloading && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled
                        className="h-7 gap-1.5 text-xs"
                      >
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      </Button>
                    )}
                    {model.pulled && !isDownloading && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(model.id)}
                        disabled={isDeleting}
                        className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {activeDownloads.size > 0 && (
          <>
            <Separator />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {activeDownloads.size} download{activeDownloads.size > 1 ? "s" : ""} in progress
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
