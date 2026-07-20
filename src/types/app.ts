import type { LucideIcon } from "lucide-react";

export type ViewId = "dashboard" | "editor" | "settings";

export interface NavItem {
  id: ViewId;
  label: string;
  icon: LucideIcon;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  duration: string;
  aspectRatio: string;
  updatedAt: string;
  status: "ready" | "draft" | "exported";
}

export interface SubtitleLine {
  id: string;
  index: number;
  start: string;
  end: string;
  text: string;
  confidence: number;
  health: "good" | "warning" | "danger";
}

export interface AsrModel {
  id: string;
  name: string;
  purpose: string;
  size: string;
  status: "installed" | "missing" | "downloading";
  speed: string;
  hardware: string;
}

export interface FontItem {
  id: string;
  name: string;
  source: "system" | "imported" | "built-in";
  format: string;
  favorite: boolean;
}
