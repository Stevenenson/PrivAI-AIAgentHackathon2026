"use client";
import {
  BriefcaseBusiness,
  Code2,
  FileText,
  GraduationCap,
  Palette,
  Search,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/BrandMark";
import { Input } from "@/components/ui/Input";
import { board } from "@/lib/board";
import {
  DetailLevel,
  type ExperiencePrefs,
  Persona,
  PrimaryGoal,
  useExperience,
} from "@/lib/experience";

const PERSONAS: Array<{
  value: Persona;
  title: string;
  body: string;
  icon: React.ReactNode;
}> = [
  {
    value: "business",
    title: "Run a business",
    body: "Automate admin, sales, documents, and operations.",
    icon: <BriefcaseBusiness className="h-4 w-4" />,
  },
  {
    value: "developer",
    title: "Build software",
    body: "Create apps, inspect code, run builds, and fix bugs.",
    icon: <Code2 className="h-4 w-4" />,
  },
  {
    value: "creator",
    title: "Create content",
    body: "Draft pages, visuals, PDFs, and polished deliverables.",
    icon: <Palette className="h-4 w-4" />,
  },
  {
    value: "student",
    title: "Learn and research",
    body: "Explain topics, summarize files, and prepare reports.",
    icon: <GraduationCap className="h-4 w-4" />,
  },
];

const GOALS: Array<{
  value: PrimaryGoal;
  title: string;
  body: string;
  icon: React.ReactNode;
}> = [
  {
    value: "automate",
    title: "Automate work",
    body: "Turn repetitive tasks into clear workflows.",
    icon: <BriefcaseBusiness className="h-4 w-4" />,
  },
  {
    value: "build",
    title: "Build apps",
    body: "Make websites, tools, dashboards, and prototypes.",
    icon: <Code2 className="h-4 w-4" />,
  },
  {
    value: "documents",
    title: "Handle documents",
    body: "Convert files, make PDFs, and summarize attachments.",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    value: "research",
    title: "Research faster",
    body: "Search, compare sources, and produce grounded answers.",
    icon: <Search className="h-4 w-4" />,
  },
];

export function OnboardingQuiz({ force = false }: { force?: boolean }) {
  const { prefs, loaded, savePrefs } = useExperience();
  if (!loaded) return null;
  if (!force && prefs.onboardingDone) return null;

  return <OnboardingQuizForm prefs={prefs} savePrefs={savePrefs} />;
}

function OnboardingQuizForm({
  prefs,
  savePrefs,
}: {
  prefs: ExperiencePrefs;
  savePrefs: (patch: Partial<ExperiencePrefs>) => void;
}) {
  const [persona, setPersona] = useState<Persona>(prefs.persona);
  const [goal, setGoal] = useState<PrimaryGoal>(prefs.primaryGoal);
  const [detailLevel, setDetailLevel] = useState<DetailLevel>(prefs.detailLevel);
  const [businessContext, setBusinessContext] = useState(prefs.businessContext);

  function finish() {
    void board.saveBusinessSettings({ privacyMode: "cloud" }).catch(() => {});
    savePrefs({
      persona,
      primaryGoal: goal,
      detailLevel,
      privacyMode: "cloud",
      businessContext: businessContext.trim(),
      onboardingDone: true,
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center px-4">
      <section className="w-full max-w-3xl rounded-[14px] border border-line bg-bg shadow-2xl overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <div className="flex items-start gap-3">
            <BrandMark className="h-10 w-10 text-lg shrink-0" />
            <div>
              <h2 className="font-serif text-2xl tracking-tight">
                Make Privai fit your work
              </h2>
              <p className="text-sm text-muted mt-1">
                A short setup tunes the home screen and answer style. You can
                change this later in Settings.
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 grid gap-6 max-h-[75vh] overflow-y-auto">
          <QuizSection title="What are you mainly using Privai for?">
            <ChoiceGrid
              items={PERSONAS}
              value={persona}
              onChange={(next) => setPersona(next as Persona)}
            />
          </QuizSection>

          <QuizSection title="What should Privai help with first?">
            <ChoiceGrid
              items={GOALS}
              value={goal}
              onChange={(next) => setGoal(next as PrimaryGoal)}
            />
          </QuizSection>

          <QuizSection title="How should answers feel?">
            <div className="grid sm:grid-cols-3 gap-2">
              {[
                ["simple", "Simple", "Plain language, fewer details"],
                ["balanced", "Balanced", "Clear steps with useful context"],
                ["technical", "Technical", "More implementation details"],
              ].map(([value, title, body]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDetailLevel(value as DetailLevel)}
                  className={`rounded-[10px] border p-3 text-left transition ${
                    detailLevel === value
                      ? "border-accent bg-accent-tint"
                      : "border-line bg-surface hover:bg-surface-2"
                  }`}
                >
                  <div className="font-medium text-sm">{title}</div>
                  <div className="text-xs text-muted mt-1">{body}</div>
                </button>
              ))}
            </div>
          </QuizSection>

          <QuizSection title="Optional business context">
            <Input
              value={businessContext}
              onChange={(e) => setBusinessContext(e.target.value)}
              placeholder="Example: ecommerce store, real estate agency, school project..."
            />
          </QuizSection>
        </div>

        <div className="border-t border-line px-5 py-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => savePrefs({ onboardingDone: true })}
          >
            Skip
          </Button>
          <Button type="button" onClick={finish}>
            Save experience
          </Button>
        </div>
      </section>
    </div>
  );
}

function QuizSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="font-medium mb-2">{title}</h3>
      {children}
    </section>
  );
}

function ChoiceGrid({
  items,
  value,
  onChange,
}: {
  items: Array<{
    value: string;
    title: string;
    body: string;
    icon: React.ReactNode;
  }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={`rounded-[10px] border p-3 text-left transition ${
            value === item.value
              ? "border-accent bg-accent-tint"
              : "border-line bg-surface hover:bg-surface-2"
          }`}
        >
          <div className="flex items-center gap-2 font-medium text-sm">
            <span className="text-accent">{item.icon}</span>
            {item.title}
          </div>
          <div className="text-xs text-muted mt-1">{item.body}</div>
        </button>
      ))}
    </div>
  );
}
