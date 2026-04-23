import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import { CLAUDE_MODELS, CODEX_MODELS, CURSOR_MODELS, GEMINI_MODELS, OPENCODE_MODELS } from '../../../../shared/modelConstants';
import type { PendingPermissionRequest, PermissionMode } from '../types/types';
import type { ProjectSession, LLMProvider } from '../../../types/app';

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
}

type ModelOption = { value: string; label: string };

export function useChatProviderState({ selectedSession }: UseChatProviderStateArgs) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [provider, setProvider] = useState<LLMProvider>(() => {
    return (localStorage.getItem('selected-provider') as LLMProvider) || 'claude';
  });
  const [cursorModel, setCursorModel] = useState<string>(() => {
    return localStorage.getItem('cursor-model') || CURSOR_MODELS.DEFAULT;
  });
  const [claudeModel, setClaudeModel] = useState<string>(() => {
    return localStorage.getItem('claude-model') || CLAUDE_MODELS.DEFAULT;
  });
  const [codexModel, setCodexModel] = useState<string>(() => {
    return localStorage.getItem('codex-model') || CODEX_MODELS.DEFAULT;
  });
  const [geminiModel, setGeminiModel] = useState<string>(() => {
    return localStorage.getItem('gemini-model') || GEMINI_MODELS.DEFAULT;
  });
  const [opencodeModel, setOpencodeModel] = useState<string>(() => {
    return localStorage.getItem('opencode-model') || OPENCODE_MODELS.DEFAULT;
  });
  const [opencodeModelOptions, setOpencodeModelOptions] = useState<ModelOption[]>(() => OPENCODE_MODELS.OPTIONS);

  const lastProviderRef = useRef(provider);

  useEffect(() => {
    if (!selectedSession?.id) {
      return;
    }

    const savedMode = localStorage.getItem(`permissionMode-${selectedSession.id}`);
    setPermissionMode((savedMode as PermissionMode) || 'default');
  }, [selectedSession?.id]);

  useEffect(() => {
    if (!selectedSession?.__provider || selectedSession.__provider === provider) {
      return;
    }

    setProvider(selectedSession.__provider);
    localStorage.setItem('selected-provider', selectedSession.__provider);
  }, [provider, selectedSession]);

  useEffect(() => {
    if (lastProviderRef.current === provider) {
      return;
    }
    setPendingPermissionRequests([]);
    lastProviderRef.current = provider;
  }, [provider]);

  useEffect(() => {
    setPendingPermissionRequests((previous) =>
      previous.filter((request) => !request.sessionId || request.sessionId === selectedSession?.id),
    );
  }, [selectedSession?.id]);

  useEffect(() => {
    if (provider !== 'cursor') {
      return;
    }

    authenticatedFetch('/api/cursor/config')
      .then((response) => response.json())
      .then((data) => {
        if (!data.success || !data.config?.model?.modelId) {
          return;
        }

        const modelId = data.config.model.modelId as string;
        if (!localStorage.getItem('cursor-model')) {
          setCursorModel(modelId);
        }
      })
      .catch((error) => {
        console.error('Error loading Cursor config:', error);
      });
  }, [provider]);

  useEffect(() => {
    let cancelled = false;

    const loadOpenCodeModels = async () => {
      try {
        const response = await authenticatedFetch('/api/opencode/models');
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        const dynamicOptions = Array.isArray(data?.options)
          ? data.options
            .filter((item: unknown) => typeof item === 'object' && item !== null)
            .map((item: { value?: unknown; label?: unknown }) => ({
              value: String(item.value || '').trim(),
              label: String(item.label || item.value || '').trim(),
            }))
            .filter((item: ModelOption) => Boolean(item.value && item.label))
          : [];

        if (cancelled || dynamicOptions.length === 0) {
          return;
        }

        // Keep selector responsive: dedupe + cap size while preserving server order.
        const byValue = new Map<string, ModelOption>();
        for (const option of dynamicOptions) {
          if (!byValue.has(option.value)) {
            byValue.set(option.value, option);
          }
        }
        const dedupedDynamic = Array.from(byValue.values());
        const limitedDynamic = dedupedDynamic.slice(0, 300);

        // Always include static quick aliases, then append dynamic options.
        const merged: ModelOption[] = [
          ...OPENCODE_MODELS.OPTIONS,
          ...limitedDynamic.filter((item: ModelOption) => item.value !== OPENCODE_MODELS.DEFAULT),
        ];
        setOpencodeModelOptions(merged);
      } catch (error) {
        console.error('Error loading OpenCode model list:', error);
      }
    };

    loadOpenCodeModels();
    return () => {
      cancelled = true;
    };
  }, []);

  const cyclePermissionMode = useCallback(() => {
    const modes: PermissionMode[] =
      provider === 'codex'
        ? ['default', 'acceptEdits', 'bypassPermissions']
        : ['default', 'acceptEdits', 'bypassPermissions', 'plan'];

    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const nextMode = modes[nextIndex];
    setPermissionMode(nextMode);

    if (selectedSession?.id) {
      localStorage.setItem(`permissionMode-${selectedSession.id}`, nextMode);
    }
  }, [permissionMode, provider, selectedSession?.id]);

  return {
    provider,
    setProvider,
    cursorModel,
    setCursorModel,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    geminiModel,
    setGeminiModel,
    opencodeModel,
    setOpencodeModel,
    opencodeModelOptions,
    permissionMode,
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  };
}
