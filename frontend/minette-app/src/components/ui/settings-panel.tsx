import { useState, useEffect, useCallback } from "react";
import { useTheme } from "next-themes";
import {
  Settings,
  Sun,
  Moon,
  Monitor,
  Cpu,
  ChevronDown,
  Check,
  AlertCircle,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useSettings, AVAILABLE_MODELS } from "@/lib/settingsStorage";
import { getPulledModels } from "@/lib/api";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { settings, setMaxTokens, setSelectedModel } = useSettings();
  const [tokenInputValue, setTokenInputValue] = useState(
    settings.maxTokens.toString()
  );
  const [pulledModelNames, setPulledModelNames] = useState<Set<string>>(new Set());

  // Fetch pulled models when settings panel opens
  const fetchPulledModels = useCallback(async () => {
    try {
      const { models } = await getPulledModels();
      const names = new Set<string>();
      models.forEach((m) => {
        names.add(m.name);
        names.add(m.name.split(":")[0]);
      });
      setPulledModelNames(names);
    } catch {
      // Silently fail — will just not show installed badges
    }
  }, []);

  useEffect(() => {
    if (open) fetchPulledModels();
  }, [open, fetchPulledModels]);

  const isModelPulled = (modelId: string) =>
    pulledModelNames.has(modelId) || pulledModelNames.has(modelId.split(":")[0]);

  const isSelectedModelPulled = isModelPulled(settings.selectedModel);

  // Sync local input when settings change externally
  const handleSliderChange = (value: number[]) => {
    const newValue = value[0];
    setMaxTokens(newValue);
    setTokenInputValue(newValue.toString());
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTokenInputValue(e.target.value);
  };

  const handleInputBlur = () => {
    const parsed = parseInt(tokenInputValue, 10);
    if (!isNaN(parsed)) {
      const clamped = Math.max(256, Math.min(8192, parsed));
      setMaxTokens(clamped);
      setTokenInputValue(clamped.toString());
    } else {
      // Reset to current value if invalid
      setTokenInputValue(settings.maxTokens.toString());
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleInputBlur();
    }
  };

  const currentTheme = resolvedTheme || theme;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Settings"
          className="relative"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end" sideOffset={8}>
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium text-sm">Settings</h4>
            <p className="text-xs text-muted-foreground">
              Customize your experience
            </p>
          </div>

          <Separator />

          {/* Theme Section */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Theme</Label>
            <div className="flex gap-2">
              <Button
                variant={theme === "light" ? "default" : "outline"}
                size="sm"
                onClick={() => setTheme("light")}
                className="flex-1 gap-2"
              >
                <Sun className="h-4 w-4" />
                Light
              </Button>
              <Button
                variant={theme === "dark" ? "default" : "outline"}
                size="sm"
                onClick={() => setTheme("dark")}
                className="flex-1 gap-2"
              >
                <Moon className="h-4 w-4" />
                Dark
              </Button>
              <Button
                variant={theme === "system" ? "default" : "outline"}
                size="sm"
                onClick={() => setTheme("system")}
                className="flex-1 gap-2"
              >
                <Monitor className="h-4 w-4" />
                Auto
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {currentTheme === "dark"
                ? "Dark mode is active"
                : "Light mode is active"}
            </p>
          </div>

          <Separator />

          {/* Max Tokens Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Max Tokens</Label>
              <Input
                type="number"
                value={tokenInputValue}
                onChange={handleInputChange}
                onBlur={handleInputBlur}
                onKeyDown={handleInputKeyDown}
                className="w-20 h-8 text-sm text-right"
                min={256}
                max={8192}
              />
            </div>
            <Slider
              value={[settings.maxTokens]}
              onValueChange={handleSliderChange}
              min={256}
              max={8192}
              step={64}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>256</span>
              <span>8192</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Controls the maximum length of AI responses. Higher values allow
              longer responses but may take more time.
            </p>
          </div>

          <Separator />

          {/* Model Selection Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">AI Model</Label>
            </div>
            <Popover
              open={modelSelectorOpen}
              onOpenChange={setModelSelectorOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={modelSelectorOpen}
                  className="w-full justify-between"
                >
                  {AVAILABLE_MODELS.find((m) => m.id === settings.selectedModel)
                    ?.name || "Select model..."}
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search models..." />
                  <CommandList>
                    <CommandEmpty>No model found.</CommandEmpty>
                    <CommandGroup>
                      {AVAILABLE_MODELS.map((model) => {
                        const pulled = isModelPulled(model.id);
                        return (
                        <CommandItem
                          key={model.id}
                          value={model.id}
                          onSelect={() => {
                            setSelectedModel(model.id);
                            setModelSelectorOpen(false);
                          }}
                          className="flex flex-col items-start gap-1 py-2"
                        >
                          <div className="flex items-center w-full">
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                settings.selectedModel === model.id
                                  ? "opacity-100"
                                  : "opacity-0"
                              )}
                            />
                            <span className="font-medium">{model.name}</span>
                            <span className="ml-auto flex items-center gap-1.5">
                              {pulled ? (
                                <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-green-600 hover:bg-green-700">
                                  Installed
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 border-amber-400">
                                  Not pulled
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {model.size}
                              </span>
                            </span>
                          </div>
                          <span className="ml-6 text-xs text-muted-foreground">
                            {model.description}
                          </span>
                        </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              {isSelectedModelPulled ? (
                <>
                  <span className="text-green-600 font-medium">Ready to use</span> — {settings.selectedModel} is installed locally.
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1 text-amber-600 font-medium">
                    <AlertCircle className="h-3 w-3 inline" />
                    Not installed
                  </span>
                  Use the <strong>Models</strong> button to download{" "}
                  <code className="text-xs bg-muted px-1 rounded">
                    {settings.selectedModel}
                  </code>{" "}
                  first.
                </>
              )}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
