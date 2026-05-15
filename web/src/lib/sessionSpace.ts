import type { ChatSession, ChatSpace } from "@/lib/types";

const SPACE_ROUTES: Record<ChatSpace, string> = {
  general: "/c",
  business: "/business",
  coding: "/coding",
  learning: "/learning",
};

export function sessionSpace(session: ChatSession): ChatSpace {
  if (session.space && session.space in SPACE_ROUTES) return session.space;

  const title = (session.title || "").toLowerCase();
  if (matches(title, LEARNING_TERMS)) return "learning";
  if (matches(title, CODING_TERMS)) return "coding";
  if (matches(title, BUSINESS_TERMS)) return "business";
  return "general";
}

export function sessionHref(session: ChatSession) {
  const space = sessionSpace(session);
  if (space === "general") return `/c/${session.id}`;
  return `${SPACE_ROUTES[space]}?session=${encodeURIComponent(session.id)}`;
}

export function spaceTitle(space: ChatSpace) {
  if (space === "business") return "Business workspace";
  if (space === "coding") return "Coding workspace";
  if (space === "learning") return "Learning workspace";
  return "New chat";
}

function matches(title: string, terms: RegExp[]) {
  return terms.some((term) => term.test(title));
}

const CODING_TERMS = [
  /\bcoding\b/,
  /\bcode\b/,
  /\bproject\b/,
  /\breact\b/,
  /\bvite\b/,
  /\bnext\.?js\b/,
  /\bnode\b/,
  /\bnpm\b/,
  /\belectron\b/,
  /\btypescript\b/,
  /\bjavascript\b/,
  /\bpython\b/,
  /\bhtml\b/,
  /\bcss\b/,
  /\bweb\s*app\b/,
  /\bapp\b/,
  /\bbuild\b/,
  /\bbug\b/,
  /\bfix\b/,
  /\brepo\b/,
  /\bterminal\b/,
  /\bapi\b/,
];

const BUSINESS_TERMS = [
  /\bbusiness\b/,
  /\bclient\b/,
  /\bcustomer\b/,
  /\bworkflow\b/,
  /\bautomation\b/,
  /\bmeeting\b/,
  /\bcalendar\b/,
  /\bemail\b/,
  /\bsales\b/,
  /\bcrm\b/,
  /\binvoice\b/,
  /\breport\b/,
  /\bdashboard\b/,
];

const LEARNING_TERMS = [
  /\blearning\b/,
  /\bstudy\b/,
  /\bquiz\b/,
  /\btest\b/,
  /\bhomework\b/,
  /\bexam\b/,
  /\bflashcard\b/,
  /\bschool\b/,
  /\blesson\b/,
  /\bteach\b/,
];
