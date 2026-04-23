import React, { useCallback, useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import SessionProviderLogo from "../../../llm-logo-provider/SessionProviderLogo";
import {
  CLAUDE_MODELS,
  CURSOR_MODELS,
  CODEX_MODELS,
  GEMINI_MODELS,
  OPENCODE_MODELS,
} from "../../../../../shared/modelConstants";
import type { ProjectSession, LLMProvider } from "../../../../types/app";
import { NextTaskBanner } from "../../../task-master";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  Card,
} from "../../../../shared/view/ui";

type ProviderSelectionEmptyStateProps = {
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: LLMProvider;
  setProvider: (next: LLMProvider) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  cursorModel: string;
  setCursorModel: (model: string) => void;
  codexModel: string;
  setCodexModel: (model: string) => void;
  geminiModel: string;
  setGeminiModel: (model: string) => void;
  opencodeModel: string;
  setOpencodeModel: (model: string) => void;
  opencodeModelOptions: { value: string; label: string }[];
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: React.Dispatch<React.SetStateAction<string>>;
};

type ProviderGroup = {
  id: LLMProvider;
  name: string;
  models: { value: string; label: string }[];
};

function getCurrentModel(
  p: LLMProvider,
  c: string,
  cu: string,
  co: string,
  g: string,
  o: string,
) {
  if (p === "claude") return c;
  if (p === "codex") return co;
  if (p === "gemini") return g;
  if (p === "opencode") return o;
  return cu;
}

function getProviderDisplayName(p: LLMProvider) {
  if (p === "claude") return "Claude Code";
  if (p === "cursor") return "Cursor";
  if (p === "codex") return "Codex";
  if (p === "opencode") return "OpenCode";
  return "Gemini";
}

export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  claudeModel,
  setClaudeModel,
  cursorModel,
  setCursorModel,
  codexModel,
  setCodexModel,
  geminiModel,
  setGeminiModel,
  opencodeModel,
  setOpencodeModel,
  opencodeModelOptions,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation("chat");
  const providerGroups = useMemo<ProviderGroup[]>(
    () => [
      { id: "claude", name: "Anthropic", models: CLAUDE_MODELS.OPTIONS },
      { id: "cursor", name: "Cursor", models: CURSOR_MODELS.OPTIONS },
      { id: "codex", name: "OpenAI", models: CODEX_MODELS.OPTIONS },
      { id: "gemini", name: "Google", models: GEMINI_MODELS.OPTIONS },
      {
        id: "opencode",
        name: "OpenCode",
        models: opencodeModelOptions.length > 0 ? opencodeModelOptions : OPENCODE_MODELS.OPTIONS,
      },
    ],
    [opencodeModelOptions],
  );

  const [dialogOpen, setDialogOpen] = useState(false);

  const visibleProviderGroups = providerGroups;

  const nextTaskPrompt = t("tasks.nextTaskPrompt", {
    defaultValue: "Start the next task",
  });

  const currentModel = getCurrentModel(
    provider,
    claudeModel,
    cursorModel,
    codexModel,
    geminiModel,
    opencodeModel,
  );

  const currentModelLabel = useMemo(() => {
    const group = providerGroups.find((item) => item.id === provider);
    const options = group?.models || [];
    const found = options.find(
      (o: { value: string; label: string }) => o.value === currentModel,
    );
    return found?.label || currentModel;
  }, [provider, currentModel, providerGroups]);

  const setModelForProvider = useCallback(
    (providerId: LLMProvider, modelValue: string) => {
      if (providerId === "claude") {
        setClaudeModel(modelValue);
        localStorage.setItem("claude-model", modelValue);
      } else if (providerId === "codex") {
        setCodexModel(modelValue);
        localStorage.setItem("codex-model", modelValue);
      } else if (providerId === "gemini") {
        setGeminiModel(modelValue);
        localStorage.setItem("gemini-model", modelValue);
      } else if (providerId === "opencode") {
        setOpencodeModel(modelValue);
        localStorage.setItem("opencode-model", modelValue);
      } else {
        setCursorModel(modelValue);
        localStorage.setItem("cursor-model", modelValue);
      }
    },
    [setClaudeModel, setCursorModel, setCodexModel, setGeminiModel, setOpencodeModel],
  );

  const handleModelSelect = useCallback(
    (providerId: LLMProvider, modelValue: string) => {
      setProvider(providerId);
      localStorage.setItem("selected-provider", providerId);
      setModelForProvider(providerId, modelValue);
      setDialogOpen(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    },
    [setProvider, setModelForProvider, textareaRef],
  );

  const handleProviderSelect = useCallback(
    (providerId: LLMProvider) => {
      setProvider(providerId);
      localStorage.setItem("selected-provider", providerId);
      setTimeout(() => textareaRef.current?.focus(), 100);
    },
    [setProvider, textareaRef],
  );

  const selectedProviderGroup = useMemo(() => {
    return visibleProviderGroups.find((group) => group.id === provider) || null;
  }, [provider, visibleProviderGroups]);

  if (!selectedSession && !currentSessionId) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              {t("providerSelection.title")}
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t("providerSelection.description")}
            </p>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {visibleProviderGroups.map((group) => {
              const isActive = provider === group.id;
              return (
                <button
                  key={`provider-${group.id}`}
                  type="button"
                  onClick={() => handleProviderSelect(group.id)}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
                    isActive
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/60 bg-background text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  <SessionProviderLogo provider={group.id} className="h-4 w-4 shrink-0" />
                  <span className="truncate font-medium">{getProviderDisplayName(group.id)}</span>
                </button>
              );
            })}
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Card
                className="group mx-auto max-w-xs cursor-pointer border-border/60 transition-all duration-150 hover:border-border hover:shadow-md active:scale-[0.99]"
                role="button"
                tabIndex={0}
              >
                <div className="flex items-center gap-2 p-3">
                  <SessionProviderLogo
                    provider={provider}
                    className="h-5 w-5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold text-foreground">
                        {getProviderDisplayName(provider)}
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="truncate text-xs text-foreground">
                        {currentModelLabel}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {t("providerSelection.clickToChange", {
                        defaultValue: "Click to change model",
                      })}
                    </p>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-y-0.5" />
                </div>
              </Card>
            </DialogTrigger>

            <DialogContent className="max-w-md overflow-hidden p-0">
              <DialogTitle>Model Selector</DialogTitle>
              <Command>
                <CommandInput
                  placeholder={t("providerSelection.searchModels", {
                    defaultValue: "Search models...",
                  })}
                />
                <CommandList className="max-h-[350px]">
                  <CommandEmpty>
                    {t("providerSelection.noModelsFound", {
                      defaultValue: "No models found.",
                    })}
                  </CommandEmpty>
                  {selectedProviderGroup && (
                    <CommandGroup
                      key={selectedProviderGroup.id}
                      heading={
                        <span className="flex items-center gap-1.5">
                          <SessionProviderLogo provider={selectedProviderGroup.id} className="h-3.5 w-3.5 shrink-0" />
                          {selectedProviderGroup.name}
                        </span>
                      }
                    >
                      {selectedProviderGroup.models.map((model) => {
                        const isSelected = currentModel === model.value;
                        return (
                          <CommandItem
                            key={`${selectedProviderGroup.id}-${model.value}`}
                            value={model.label}
                            onSelect={() => handleModelSelect(selectedProviderGroup.id, model.value)}
                          >
                            <span className="flex-1 truncate">{model.label}</span>
                            {isSelected && (
                              <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                            )}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </DialogContent>
          </Dialog>

          <p className="mt-4 text-center text-sm text-muted-foreground/70">
            {
              {
                claude: t("providerSelection.readyPrompt.claude", {
                  model: claudeModel,
                }),
                cursor: t("providerSelection.readyPrompt.cursor", {
                  model: cursorModel,
                }),
                codex: t("providerSelection.readyPrompt.codex", {
                  model: codexModel,
                }),
                gemini: t("providerSelection.readyPrompt.gemini", {
                  model: geminiModel,
                }),
                opencode: t("providerSelection.readyPrompt.opencode", {
                  model: opencodeModel,
                }),
              }[provider]
            }
          </p>

          {provider && tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner
                onStartTask={() => setInput(nextTaskPrompt)}
                onShowAllTasks={onShowAllTasks}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (selectedSession) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md px-6 text-center">
          <p className="mb-1.5 text-lg font-semibold text-foreground">
            {t("session.continue.title")}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("session.continue.description")}
          </p>

          {tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner
                onStartTask={() => setInput(nextTaskPrompt)}
                onShowAllTasks={onShowAllTasks}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
