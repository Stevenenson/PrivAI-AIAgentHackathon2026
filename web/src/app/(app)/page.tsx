"use client";
import {
  AppWindow,
  Bot,
  BriefcaseBusiness,
  Bug,
  ChartNoAxesCombined,
  Code2,
  FileText,
  Gamepad2,
  MonitorCog,
  Rocket,
  Search,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { BoardStatusPill } from "@/components/BoardStatus";
import { Composer } from "@/components/Composer";
import { Button } from "@/components/ui/Button";
import { WorkspaceBar } from "@/components/WorkspaceBar";
import { useAuth } from "@/lib/auth";
import { board } from "@/lib/board";
import {
  goalLabel,
  personaLabel,
  useExperience,
  type ExperiencePrefs,
} from "@/lib/experience";
import type { AttachmentMeta, ChatMode } from "@/lib/types";

export default function ChatHome() {
  const { user } = useAuth();
  const { prefs } = useExperience();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [terminalEnabled, setTerminalEnabled] = useState(false);
  const [agentMaxToolSteps, setAgentMaxToolSteps] = useState(20);
  const templates = useMemo(() => templatesForExperience(prefs), [prefs]);

  useEffect(() => {
    board.health()
      .then((h) => {
        setWorkspaceRoot(h.workspaceRoot || "");
        setTerminalEnabled(Boolean(h.terminalEnabled));
        setAgentMaxToolSteps(h.agentMaxToolSteps || 20);
      })
      .catch(() => {
        /* status pill surfaces backend issues */
      });
  }, []);

  async function send(
    text: string,
    opts: {
      forceSearch: boolean;
      mode: ChatMode;
      attachmentIds: string[];
      attachments: AttachmentMeta[];
    },
  ) {
    setBusy(true);
    setErr(null);
    try {
      const s = await board.createSession(text);
      const params = new URLSearchParams({
        prompt: text,
        web: opts.forceSearch ? "1" : "0",
        agent: opts.mode === "agent" ? "1" : "0",
        convert: opts.mode === "convert" ? "1" : "0",
      });
      if (opts.attachmentIds.length) {
        params.set("att", opts.attachmentIds.join(","));
      }
      router.push(`/c/${s.id}?${params.toString()}`);
    } catch (e) {
      const msg = (e as Error).message;
      setErr(
        /not paired|409/.test(msg)
          ? "Your account isn't paired to a device yet. Open Settings."
          : msg,
      );
      setBusy(false);
    }
  }

  function runTemplate(prompt: string) {
    void send(prompt, {
      forceSearch: false,
      mode: "agent",
      attachmentIds: [],
      attachments: [],
    });
  }

  return (
    <>
      <div className="shrink-0 px-4 md:px-6 py-3 border-b border-line flex items-center justify-between bg-bg sticky top-0 z-10">
        <div className="font-serif text-lg tracking-tight">New chat</div>
        {user ? <BoardStatusPill uid={user.uid} /> : null}
      </div>

      <WorkspaceBar
        workspaceRoot={workspaceRoot}
        terminalEnabled={terminalEnabled}
        maxToolSteps={agentMaxToolSteps}
        onWorkspaceChanged={setWorkspaceRoot}
      />

      <div className="min-h-0 flex-1 grid place-items-center px-6">
        <div className="max-w-3xl w-full text-center">
          <h2 className="font-serif text-4xl tracking-tight mb-3">
            Hello{user?.displayName ? `, ${firstName(user.displayName)}` : ""}.
          </h2>
          <p className="text-muted">
            {headlineForExperience(prefs)}
          </p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
            {personaLabel(prefs.persona)} · {goalLabel(prefs.primaryGoal)} ·{" "}
            {privacyLabel()}
            {prefs.businessContext ? ` · ${prefs.businessContext}` : ""}
          </div>
          <TemplateGrid busy={busy} templates={templates} onPick={runTemplate} />
          {err ? (
            <div className="mt-4 text-bad text-sm bg-bad/5 border border-bad/20 rounded-[8px] px-3 py-2 text-left">
              {err}
            </div>
          ) : null}
        </div>
      </div>

      <Composer
        onSend={send}
        disabled={busy}
        placeholder="Start a new conversation…"
        workspaceRoot={workspaceRoot}
        agentMaxToolSteps={agentMaxToolSteps}
        askBeforeCommands={prefs.askBeforeCommands}
      />
    </>
  );
}

type Template = {
  title: string;
  body: string;
  prompt: string;
  icon: React.ReactNode;
};

const BUSINESS_TEMPLATES: Template[] = [
  {
    title: "Automate a workflow",
    body: "Map a repetitive process and create a usable automation plan or script.",
    prompt:
      "Help me automate a business workflow in this workspace. Start by asking for or inferring the steps, create a practical workflow document and any useful script/template files, then verify the files exist and summarize how to use them.",
    icon: <BriefcaseBusiness className="h-4 w-4" />,
  },
  {
    title: "Client follow-up system",
    body: "Create email/SMS follow-up templates and a simple tracking sheet.",
    prompt:
      "Create a client follow-up kit in this workspace for a small business. Include message templates, a simple CSV tracker, and clear instructions. Verify the files were created.",
    icon: <Bot className="h-4 w-4" />,
  },
  {
    title: "Business dashboard",
    body: "Build a lightweight dashboard prototype for operations or sales.",
    prompt:
      "Create a small business dashboard prototype called privai-business-dashboard in this workspace. Use realistic sample data, make it easy to understand, run the build or smoke check, and tell me how to preview it.",
    icon: <ChartNoAxesCombined className="h-4 w-4" />,
  },
];

const DEVELOPER_TEMPLATES: Template[] = [
  {
    title: "React app",
    body: "Create a Vite React app, replace the starter, and run the build.",
    prompt:
      "Create a new Vite React app called privai-react-demo in this workspace. Replace the starter content with a polished working app, run npm run lint and npm run build, then tell me how to run it.",
    icon: <AppWindow className="h-4 w-4" />,
  },
  {
    title: "Fix project",
    body: "Inspect an existing app, fix the issue, and verify it.",
    prompt:
      "Inspect the current workspace, identify why the app is not showing the intended result, fix the files, run the relevant lint/build checks, and summarize the changed files.",
    icon: <Bug className="h-4 w-4" />,
  },
  {
    title: "Electron app",
    body: "Scaffold a small desktop app with a runnable dev command.",
    prompt:
      "Create a small Electron app called privai-electron-demo in this workspace. Make it runnable, add a clean first screen, run its verification command, and tell me how to start it.",
    icon: <MonitorCog className="h-4 w-4" />,
  },
  {
    title: "Python tool",
    body: "Create a CLI script with a quick smoke check.",
    prompt:
      "Create a Python CLI tool called privai_tool.py in this workspace. Include a useful --help output, run a smoke check, and tell me the command to use it.",
    icon: <Code2 className="h-4 w-4" />,
  },
];

const DOCUMENT_TEMPLATES: Template[] = [
  {
    title: "Make a PDF kit",
    body: "Draft a clear document package for customers, staff, or school.",
    prompt:
      "Create a document kit in this workspace. Include a polished Markdown source, a short checklist, and instructions for turning it into a PDF. Verify the files were created.",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    title: "Research brief",
    body: "Search, compare sources, and produce a concise brief.",
    prompt:
      "Research the topic I give you, use web sources, and create a concise brief file in this workspace with key points, recommendations, and source links. Ask me for the topic if needed.",
    icon: <Search className="h-4 w-4" />,
  },
  {
    title: "Landing page",
    body: "Make a polished page for an offer, product, or service.",
    prompt:
      "Create a polished responsive landing page project called privai-landing-demo in this workspace. Use real source files, run a build or smoke check, and tell me how to preview it.",
    icon: <Rocket className="h-4 w-4" />,
  },
];

const CREATIVE_TEMPLATES: Template[] = [
  {
    title: "Game",
    body: "Build a playable browser game and verify the build.",
    prompt:
      "Create a new browser game called privai-game-demo in this workspace. Make it playable, run the build or a smoke check, and tell me how to open it.",
    icon: <Gamepad2 className="h-4 w-4" />,
  },
  {
    title: "Campaign page",
    body: "Create a polished page for a campaign, launch, or event.",
    prompt:
      "Create a polished campaign page project called privai-campaign-demo in this workspace. Make it visually clear, run a build or smoke check, and tell me how to preview it.",
    icon: <Rocket className="h-4 w-4" />,
  },
];

function headlineForExperience(prefs: ExperiencePrefs) {
  if (prefs.primaryGoal === "automate") {
    return "What process should Privai help you simplify today?";
  }
  if (prefs.primaryGoal === "build") {
    return "What do you want Privai to build or fix today?";
  }
  if (prefs.primaryGoal === "documents") {
    return "What file, document, or report should Privai help with?";
  }
  return "What should Privai research or explain today?";
}

function templatesForExperience(prefs: ExperiencePrefs): Template[] {
  if (prefs.persona === "developer" || prefs.primaryGoal === "build") {
    return [...DEVELOPER_TEMPLATES, ...BUSINESS_TEMPLATES.slice(0, 1)];
  }
  if (prefs.persona === "creator") {
    return [...CREATIVE_TEMPLATES, ...DOCUMENT_TEMPLATES];
  }
  if (prefs.persona === "student" || prefs.primaryGoal === "research") {
    return [...DOCUMENT_TEMPLATES, ...DEVELOPER_TEMPLATES.slice(1, 3)];
  }
  return [...BUSINESS_TEMPLATES, ...DOCUMENT_TEMPLATES];
}

function TemplateGrid({
  busy,
  templates,
  onPick,
}: {
  busy: boolean;
  templates: Template[];
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-left">
      {templates.map((template) => (
        <Button
          key={template.title}
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => onPick(template.prompt)}
          className="h-auto min-h-24 flex-col items-start justify-start p-4 text-left"
        >
          <span className="inline-flex items-center gap-2">
            <span className="text-accent">{template.icon}</span>
            {template.title}
          </span>
          <span className="text-xs text-muted font-normal leading-5">
            {template.body}
          </span>
        </Button>
      ))}
    </div>
  );
}

function firstName(name: string) {
  return name.split(" ")[0];
}

function privacyLabel() {
  return "Gemini API";
}
