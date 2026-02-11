import { useState, useCallback } from 'react';
import {
  listModels,
  getModel,
  downloadModel,
  deleteModel,
  getModelStatus,
  searchModels,
  listRepoFiles,
  ModelInfo,
  ModelSearchResult,
} from '@/lib/api';

export interface UseModelsReturn {
  models: ModelInfo[];
  loading: boolean;
  error: string | null;
  refreshModels: () => Promise<void>;
  downloadNewModel: (repoId: string, filename: string, modelId?: string) => Promise<ModelInfo | null>;
  removeModel: (modelId: string) => Promise<boolean>;
  searchHuggingFaceModels: (query: string, limit?: number, task?: string) => Promise<ModelSearchResult[]>;
  getRepoFiles: (repoId: string) => Promise<string[]>;
  getModelDownloadStatus: (modelId: string) => Promise<{
    progress: number;
    status: string;
    error: string | null;
  } | null>;
}

export function useModels(): UseModelsReturn {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listModels();
      setModels(result.models);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load models';
      setError(message);
      console.error('Error loading models:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const downloadNewModel = useCallback(async (
    repoId: string,
    filename: string,
    modelId?: string
  ): Promise<ModelInfo | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await downloadModel(repoId, filename, modelId);
      // Refresh the models list after download
      await refreshModels();
      // Get the full model info
      const modelInfo = await getModel(result.model_id);
      return modelInfo;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to download model';
      setError(message);
      console.error('Error downloading model:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [refreshModels]);

  const removeModel = useCallback(async (modelId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const result = await deleteModel(modelId);
      if (result.deleted) {
        // Refresh the models list after deletion
        await refreshModels();
        return true;
      }
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete model';
      setError(message);
      console.error('Error deleting model:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshModels]);

  const searchHuggingFaceModels = useCallback(async (
    query: string,
    limit: number = 10,
    task?: string
  ): Promise<ModelSearchResult[]> => {
    setLoading(true);
    setError(null);
    try {
      const result = await searchModels(query, limit, task);
      return result.results;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to search models';
      setError(message);
      console.error('Error searching models:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const getRepoFiles = useCallback(async (repoId: string): Promise<string[]> => {
    try {
      const result = await listRepoFiles(repoId);
      return result.files;
    } catch (err) {
      console.error('Error listing repo files:', err);
      return [];
    }
  }, []);

  const getModelDownloadStatus = useCallback(async (modelId: string) => {
    try {
      const status = await getModelStatus(modelId);
      return {
        progress: status.progress,
        status: status.status,
        error: status.error,
      };
    } catch (err) {
      console.error('Error getting model status:', err);
      return null;
    }
  }, []);

  return {
    models,
    loading,
    error,
    refreshModels,
    downloadNewModel,
    removeModel,
    searchHuggingFaceModels,
    getRepoFiles,
    getModelDownloadStatus,
  };
}
