import type { Profession, SchoolId } from "@avanpost/shared";

export type { Profession, SchoolId };

export interface SchoolInfo {
  id: SchoolId;
  label: string;
  short: string;
  sign: string;
}

export const SCHOOLS: Record<SchoolId, SchoolInfo> = {
  gather: { id: "gather", label: "Школа добычи", short: "Д", sign: "Школа добычи" },
  craft: { id: "craft", label: "Школа ремёсел", short: "Р", sign: "Школа ремёсел" },
};

export const PROFESSION_COLORS: Record<Profession, string> = {
  Разнорабочий: "#9aa39b",
  Добытчик: "#c77b3f",
  Ремесленник: "#7c8fd4",
  Каменотёс: "#c9b458",
};

export const PROFESSION_DESCRIPTIONS: Record<Profession, string> = {
  Разнорабочий: "базовая стройка и перенос грузов",
  Добытчик: "специализация на добыче сырья",
  Ремесленник: "простые производственные операции",
  Каменотёс: "извлечение и обработка камня",
};
