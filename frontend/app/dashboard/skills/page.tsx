"use client";

import { useRouter } from "next/navigation";

// ── Skill definitions ─────────────────────────────────────────────────────────

interface SkillDef {
  cmd: string;
  label: string;
  labelRu: string;
  description: string;
  descriptionRu: string;
  status: "active" | "soon";
  example?: string;
}

const SKILLS: SkillDef[] = [
  {
    cmd: "[SAVE_MEMORY: ...]",
    label: "Save Memory",
    labelRu: "Запомнить",
    description: "AI extracts a key fact from the conversation and saves it to long-term memory. Triggered when the AI decides something is worth remembering.",
    descriptionRu: "AI извлекает ключевой факт из разговора и сохраняет его в долгосрочную память. Запускается когда AI решает что-то стоит запомнить.",
    status: "active",
    example: "[SAVE_MEMORY: Пользователь продала дом в ноябре после долгой уборки]",
  },
  {
    cmd: "[SEARCH_MEMORIES: ...]",
    label: "Search Memories",
    labelRu: "Поиск воспоминаний",
    description: "AI searches raw conversation history in pgvector for relevant past context. Results are injected as an agentic step — AI receives them and replies with awareness of what it found.",
    descriptionRu: "AI ищет в истории разговоров через pgvector релевантный контекст. Результаты инжектируются как агентный шаг — AI получает их и отвечает с учётом найденного.",
    status: "active",
    example: "[SEARCH_MEMORIES: работа начальница конфликт]",
  },
  {
    cmd: "[WEB_SEARCH: ...]",
    label: "Web Search",
    labelRu: "Поиск в интернете",
    description: "AI searches the live web for fresh external information such as weather, news, prices, addresses, or opening hours, then folds it into the reply.",
    descriptionRu: "AI ищет актуальную информацию в интернете: погоду, новости, цены, адреса, часы работы — и затем вплетает найденное в ответ.",
    status: "active",
    example: "[WEB_SEARCH: погода Ереван Ленинградян 21/15]",
  },
];

// ── How it works steps ────────────────────────────────────────────────────────

const HOW_IT_WORKS = [
  {
    step: "01",
    text: "AI decides a fact is worth saving and adds [SAVE_MEMORY: ...] to the end of its reply",
    textRu: "AI решает что факт стоит сохранить и добавляет [SAVE_MEMORY: ...] в конец ответа",
  },
  {
    step: "02",
    text: "Backend strips the command from the visible text, extracts fact + category via LLM, rates importance 1–4",
    textRu: "Бэкенд убирает команду из видимого текста, извлекает факт + категорию через LLM, оценивает важность 1–4",
  },
  {
    step: "03",
    text: "Fact is stored in ChromaDB with embeddings. You see a small ✦ note under the message",
    textRu: "Факт сохраняется в ChromaDB с эмбеддингами. Под сообщением появляется пометка ✦",
  },
  {
    step: "04",
    text: "On next messages, relevant facts are automatically pulled from Chroma and placed in AI context",
    textRu: "В следующих сообщениях релевантные факты автоматически подтягиваются из Chroma в контекст AI",
  },
];

export default function SkillsPage() {
  const router = useRouter();

  return (
    <div className="flex h-screen w-screen flex-col bg-black text-white">

      {/* ── Header ── */}
      <header className="shrink-0 flex items-center justify-between border-b border-white/8 px-12 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-[1.4rem] font-extralight tracking-[0.28em] uppercase text-white/80">
            Skills
          </h1>
          <p className="text-[0.62rem] tracking-[0.18em] uppercase text-white/25">
            AI-invoked capabilities · agentic pipeline
          </p>
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          className="text-[0.65rem] tracking-[0.2em] uppercase text-white/30 transition-colors hover:text-white/75"
        >
          ← dashboard
        </button>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-12 py-10">
        <div className="mx-auto max-w-4xl flex flex-col gap-14">

          {/* ── Skill cards grid ── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {SKILLS.map((skill) => (
              <div
                key={skill.cmd}
                className={`
                  border p-6 flex flex-col gap-4
                  transition-colors duration-300
                  ${skill.status === "active"
                    ? "border-white/18 hover:border-white/40 bg-white/[0.015]"
                    : "border-white/8 bg-black opacity-50"
                  }
                `}
              >
                {/* Top row */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[0.95rem] font-light tracking-[0.18em] uppercase text-white/75">
                      {skill.label}
                    </span>
                    <span className="text-[0.72rem] tracking-[0.1em] text-white/35">
                      {skill.labelRu}
                    </span>
                  </div>
                  <span
                    className={`
                      shrink-0 border px-2.5 py-1 text-[0.55rem] tracking-[0.2em] uppercase
                      ${skill.status === "active"
                        ? "border-white/25 text-white/50"
                        : "border-white/10 text-white/20"
                      }
                    `}
                  >
                    {skill.status === "active" ? "active" : "coming soon"}
                  </span>
                </div>

                {/* Command chip */}
                <code className="block w-full border border-white/10 bg-white/[0.03] px-3 py-2 text-[0.68rem] tracking-[0.06em] text-white/45 font-mono">
                  {skill.cmd}
                </code>

                {/* Description */}
                <p className="text-[0.78rem] leading-relaxed text-white/45">
                  {skill.description}
                </p>
                <p className="text-[0.72rem] leading-relaxed text-white/28">
                  {skill.descriptionRu}
                </p>

                {/* Example */}
                {skill.example && (
                  <div className="border-t border-white/8 pt-3">
                    <p className="mb-1 text-[0.55rem] tracking-[0.2em] uppercase text-white/20">
                      example
                    </p>
                    <code className="block text-[0.65rem] leading-relaxed text-white/30 font-mono break-all">
                      {skill.example}
                    </code>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ── How it works ── */}
          <div>
            <p className="mb-6 text-[0.6rem] tracking-[0.28em] uppercase text-white/20">
              how it works · как это работает
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {HOW_IT_WORKS.map((item) => (
                <div
                  key={item.step}
                  className="border border-white/8 p-5 flex flex-col gap-3"
                >
                  <span className="text-[1.6rem] font-extralight tracking-[0.1em] text-white/12 leading-none">
                    {item.step}
                  </span>
                  <p className="text-[0.72rem] leading-relaxed text-white/45">
                    {item.text}
                  </p>
                  <p className="text-[0.65rem] leading-relaxed text-white/25 border-t border-white/6 pt-3">
                    {item.textRu}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Context flow note ── */}
          <div className="border border-white/8 p-6 flex flex-col gap-4">
            <p className="text-[0.6rem] tracking-[0.24em] uppercase text-white/20">
              memory context flow
            </p>
            <div className="flex items-center gap-0 flex-wrap">
              {[
                { label: "user message", sub: "query text" },
                { label: "→" },
                { label: "chroma search", sub: "multi-query" },
                { label: "→" },
                { label: "facts block", sub: "in context" },
                { label: "→" },
                { label: "ai reply", sub: "aware of past" },
                { label: "→" },
                { label: "[SAVE_MEMORY]", sub: "if needed" },
                { label: "→" },
                { label: "chroma store", sub: "new fact" },
              ].map((node, i) =>
                node.sub === undefined ? (
                  <span key={i} className="text-[0.7rem] text-white/20 px-1">{node.label}</span>
                ) : (
                  <div key={i} className="border border-white/10 px-3 py-2 flex flex-col gap-0.5 my-1">
                    <span className="text-[0.65rem] tracking-[0.12em] uppercase text-white/45">{node.label}</span>
                    <span className="text-[0.55rem] tracking-[0.1em] text-white/22">{node.sub}</span>
                  </div>
                )
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
