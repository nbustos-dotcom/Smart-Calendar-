// ============================================================================
// EXAMS — read the student's entered tests (server-only)
//
// Exams are spacing-driven and Canvas can't expose them, so the student enters
// them. Per-user RLS keeps each student to their own rows. Write paths (add /
// delete) live in src/app/scheduler/actions.ts.
// ============================================================================
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ExamItem } from "@/lib/types";

type ExamRow = {
  id: string;
  title: string;
  course_name: string | null;
  exam_at: string;
  est_prep_minutes: number | null;
};

export async function listExams(): Promise<ExamItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("exams")
    .select("id, title, course_name, exam_at, est_prep_minutes")
    .order("exam_at", { ascending: true });

  return ((data ?? []) as ExamRow[]).map((r) => ({
    id: r.id,
    title: r.title,
    course_name: r.course_name,
    exam_at: r.exam_at,
    est_prep_minutes: r.est_prep_minutes,
  }));
}
