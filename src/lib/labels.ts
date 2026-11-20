import { CATEGORIES, CONDITIONS } from "../../convex/lib/constants";

export type Category = (typeof CATEGORIES)[number];
export type Condition = (typeof CONDITIONS)[number];

export { CATEGORIES, CONDITIONS };

export const CATEGORY_LABEL: Record<Category, string> = {
  power_tools: "Power tools",
  hand_tools: "Hand tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  cleaning: "Cleaning",
  other: "Other",
};

export const CONDITION_LABEL: Record<Condition, string> = {
  new: "New",
  good: "Good",
  fair: "Fair",
  worn: "Worn",
};

export const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  approved: "bg-brand-50 text-brand-700 border-brand-100",
  declined: "bg-stone-100 text-stone-600 border-stone-200",
  cancelled: "bg-stone-100 text-stone-600 border-stone-200",
  returned: "bg-sky-50 text-sky-800 border-sky-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
};
