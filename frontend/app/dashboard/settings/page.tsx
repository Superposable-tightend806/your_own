"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MODELS = [
  { id: "anthropic/claude-opus-4.6",  label: "Claude Opus 4.6",  vision: true  },
  { id: "z-ai/glm-5",                 label: "GLM 5",             vision: false },
  { id: "openai/gpt-5.1",             label: "GPT 5.1",           vision: true  },
  { id: "openai/gpt-5.4",             label: "GPT 5.4",           vision: true  },
  { id: "moonshotai/kimi-k2.5",       label: "Kimi K2.5",         vision: false },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick",  vision: false },
  { id: "meta-llama/llama-4-scout",    label: "Llama 4 Scout",     vision: false },
  { id: "google/gemini-3-pro-preview", label: "Gemini 3 Pro Preview", vision: false },
  { id: "qwen/qwen3-max",              label: "Qwen 3",            vision: false },
  { id: "deepseek/deepseek-v3.2",     label: "Deepseek V3.2",     vision: false },
  { id: "mistralai/mistral-large",    label: "Mistral Large",     vision: false },
] as const;

type ModelId = (typeof MODELS)[number]["id"];

function isElectron(): boolean {
  return typeof window !== "undefined" && "yourOwn" in window;
}

function SliderRow({
  label,
  hint,
  value,
  onChange,
  min = 1,
  max = 10,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <label className="text-[0.68rem] tracking-[0.22em] uppercase text-white/55">
          {label}
        </label>
        <span className="text-[0.88rem] font-light tabular-nums text-white/80">
          {value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider w-full"
      />
      <p className="text-[0.62rem] tracking-wide text-white/40">{hint}</p>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();

  const [apiKey, setApiKey]             = useState("");
  const [model, setModel]               = useState<ModelId>(MODELS[0].id);
  const [temperature, setTemperature]   = useState(7);
  const [topP, setTopP]                 = useState(9);
  const [historyPairs, setHistoryPairs]       = useState(6);
  const [memoryCutoffDays, setMemoryCutoffDays] = useState(2);
  const [saved, setSaved]               = useState(false);
  const [masked, setMasked]             = useState(true);
  const [open, setOpen]                 = useState(false);
  const dropdownRef                     = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isElectron()) return;
    (async () => {
      const key  = await window.yourOwn.getApiKey();
      if (key) setApiKey(key);
      const m    = await window.yourOwn.getModel();
      if (m && MODELS.find((x) => x.id === m)) setModel(m as ModelId);
      const temp = await window.yourOwn.getTemperature();
      if (temp) setTemperature(Number(temp));
      const tp   = await window.yourOwn.getTopP();
      if (tp) setTopP(Number(tp));
      const history = await window.yourOwn.getHistoryPairs();
      if (history) setHistoryPairs(Number(history));
      const cutoff = await window.yourOwn.getMemoryCutoffDays();
      if (cutoff) setMemoryCutoffDays(Number(cutoff));
    })();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSave = async () => {
    if (isElectron()) {
      await window.yourOwn.saveApiKey(apiKey);
      await window.yourOwn.saveModel(model);
      await window.yourOwn.saveTemperature(String(temperature));
      await window.yourOwn.saveTopP(String(topP));
      await window.yourOwn.saveHistoryPairs(String(historyPairs));
      await window.yourOwn.saveMemoryCutoffDays(String(memoryCutoffDays));
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const selectedLabel = MODELS.find((m) => m.id === model)?.label ?? "";

  return (
    <div className="flex h-screen w-screen flex-col bg-black text-white">
      <div className="sticky top-0 z-10 border-b border-white/8 bg-black/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between px-8 py-6">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-[0.72rem] tracking-[0.2em] uppercase text-white/50 transition-colors duration-300 hover:text-white/90"
          >
            ← back
          </button>
          <h2 className="text-[1.5rem] font-light tracking-[0.18em] uppercase text-white">
            Settings
          </h2>
          <div className="w-[72px]" />
        </div>
      </div>

      <div className="flex-1 overflow-auto py-12">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-10 px-8">

        {/* API Key */}
        <div className="flex flex-col gap-3">
          <label className="text-[0.68rem] tracking-[0.22em] uppercase text-white/55">
            OpenRouter API Key
          </label>
          <div className="flex items-center gap-3">
            <input
              type={masked ? "password" : "text"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-..."
              spellCheck={false}
              className="
                flex-1 border-b border-white/30 bg-transparent
                py-3 text-[1rem] font-light tracking-wide text-white
                placeholder:text-white/30 outline-none
                transition-colors duration-300
                focus:border-white/70
              "
            />
            <button
              onClick={() => setMasked((v) => !v)}
              className="shrink-0 text-[0.68rem] tracking-[0.16em] uppercase text-white/40 transition-colors duration-300 hover:text-white/80"
            >
              {masked ? "show" : "hide"}
            </button>
          </div>
        </div>

        {/* Model */}
        <div className="flex flex-col gap-3" ref={dropdownRef}>
          <label className="text-[0.68rem] tracking-[0.22em] uppercase text-white/55">
            Model
          </label>
          <div className="relative">
            <button
              onClick={() => setOpen((v) => !v)}
              className="
                flex w-full items-center justify-between
                border-b border-white/30 py-3 text-left
                text-[1rem] font-light tracking-wide text-white
                transition-colors duration-300
                hover:border-white/60
              "
            >
              <span>{selectedLabel}</span>
              <span className="text-[0.65rem] tracking-widest text-white/45">
                {open ? "▲" : "▼"}
              </span>
            </button>
            {open && (
              <ul className="absolute left-0 right-0 top-full z-10 mt-1 border border-white/25 bg-black">
                {MODELS.map((m) => (
                  <li key={m.id}>
                    <button
                      onClick={() => { setModel(m.id); setOpen(false); }}
                      className={`
                        w-full flex items-center justify-between px-4 py-3 text-left
                        text-[0.92rem] font-light tracking-wide
                        transition-colors duration-200 hover:bg-white/[0.06]
                        ${model === m.id ? "text-white" : "text-white/60"}
                      `}
                    >
                      <span>{m.label}</span>
                      {m.vision && (
                        <span className="text-[0.6rem] tracking-widest uppercase text-white/40">
                          vision
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Chat retrieval settings */}
        <div className="flex flex-col gap-3">
          <label className="text-[0.68rem] tracking-[0.22em] uppercase text-white/55">
            Chat Context
          </label>
          <p className="text-[0.62rem] tracking-wide text-white/35 -mt-1">
            Recent conversation and recalled memories included in each chat prompt.
          </p>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 mt-2">
            <SliderRow
              label="Message History Pairs"
              hint="How many recent user/assistant pairs to include as the active thread."
              value={historyPairs}
              onChange={setHistoryPairs}
              min={1}
              max={10}
            />
            <SliderRow
              label="Memory Cutoff Days"
              hint="Only recall memories older than this many days. Prevents recycling recent context."
              value={memoryCutoffDays}
              onChange={setMemoryCutoffDays}
              min={1}
              max={10}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/10" />

        {/* Temperature */}
        <SliderRow
          label="Temperature"
          hint="Controls randomness. Low = precise, high = creative."
          value={temperature}
          onChange={setTemperature}
        />

        {/* Top-P */}
        <SliderRow
          label="Top-P"
          hint="Nucleus sampling. Lower = more focused vocabulary."
          value={topP}
          onChange={setTopP}
        />

        {/* Save */}
        <button
          onClick={handleSave}
          className="
            self-start border border-white/30 px-8 py-3
            text-[0.72rem] tracking-[0.22em] uppercase text-white/70
            transition-colors duration-500
            hover:border-white/70 hover:text-white
          "
        >
          {saved ? "saved" : "save"}
        </button>

        {!isElectron() && (
          <p className="text-[0.65rem] tracking-wide text-white/35">
            Running in browser — keys are not persisted. Open in Electron to save securely.
          </p>
        )}
      </div>
      </div>

      <style jsx>{`
        .slider {
          -webkit-appearance: none;
          appearance: none;
          height: 1px;
          background: rgba(255, 255, 255, 0.15);
          outline: none;
          cursor: pointer;
        }
        .slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.7);
          transition: background 0.2s;
        }
        .slider::-webkit-slider-thumb:hover {
          background: #fff;
        }
        .slider::-moz-range-thumb {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          border: none;
          background: rgba(255, 255, 255, 0.7);
        }
      `}</style>
    </div>
  );
}
