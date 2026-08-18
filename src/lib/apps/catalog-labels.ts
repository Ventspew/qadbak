import type { AppCategory } from "./catalog-types";

export const CATEGORY_LABELS: Record<AppCategory, string> = {
  cms: "Content & CMS",
  tools: "Tools & databases",
  collaboration: "Collaboration",
  analytics: "Analytics",
  ecommerce: "E-commerce",
  education: "Education",
  forum: "Forums",
  surveys: "Surveys",
  media: "Media & galleries",
  finance: "Finance",
  support: "Support & helpdesk",
};

export const CATEGORY_ORDER: AppCategory[] = [
  "cms",
  "ecommerce",
  "collaboration",
  "education",
  "forum",
  "analytics",
  "surveys",
  "media",
  "finance",
  "support",
  "tools",
];
