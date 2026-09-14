"use server";

// ============================================================================
// STUDY SCHEDULER — server actions (the write path for the scheduler feature)
//
// All run on the server as the signed-in user, so per-user RLS keeps each
// student to their own rows. Nothing here writes to Canvas or Google.
//   * runPlannerAction        — (re)generate the schedule
//   * setStudyBlockTimeAction — accept a student's manual move (silently)
//   * addExamAction / deleteExamAction — manage entered exams
//   * setAssignmentTypeAction — answer a "needs input" question, once
// ============================================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runPlanner } from "@/lib/study-blocks";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// Regenerate the schedule. Called by the "Plan my study time" button and at the
// end of a Canvas sync.
export async function runPlannerAction(): Promise<ActionResult> {
  const res = await runPlanner();
  if (!res.ok) return { ok: false, error: res.error ?? "Could not plan." };
  revalidatePath("/");
  return { ok: true };
}

// Accept a student's drag of a study block: update its time and mark it as
// user-moved so the next plan run leaves it put and schedules around it. No
// confirmation — moving is always accepted.
export async function setStudyBlockTimeAction(
  id: string,
  startsAt: string,
  endsAt: string
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("study_blocks")
    .update({
      starts_at: startsAt,
      ends_at: endsAt,
      moved_by_user: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

// Add an exam, then re-plan so its spaced study sessions appear immediately.
export async function addExamAction(input: {
  title: string;
  courseName: string | null;
  examAt: string; // ISO
  estPrepMinutes: number | null;
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the exam a title." };
  if (!input.examAt) return { ok: false, error: "Pick when the exam is." };

  const { error } = await supabase.from("exams").insert({
    user_id: user.id,
    title,
    course_name: input.courseName?.trim() || null,
    exam_at: input.examAt,
    est_prep_minutes:
      input.estPrepMinutes != null && input.estPrepMinutes > 0
        ? Math.round(input.estPrepMinutes)
        : null,
  });
  if (error) return { ok: false, error: error.message };

  await runPlanner();
  revalidatePath("/");
  return { ok: true };
}

export async function deleteExamAction(id: string): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Its study blocks cascade via the FK; then re-plan the rest.
  const { error } = await supabase.from("exams").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await runPlanner();
  revalidatePath("/");
  return { ok: true };
}

// Answer a "needs input" question for an assignment: store the type (and an
// optional estimate) so it's never asked again, then re-plan.
export async function setAssignmentTypeAction(input: {
  canvasAssignmentId: number;
  category: string;
  estMinutes: number | null;
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("assignment_overrides").upsert(
    {
      user_id: user.id,
      canvas_assignment_id: input.canvasAssignmentId,
      task_category: input.category,
      est_minutes:
        input.estMinutes != null && input.estMinutes > 0
          ? Math.round(input.estMinutes)
          : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,canvas_assignment_id" }
  );
  if (error) return { ok: false, error: error.message };

  await runPlanner();
  revalidatePath("/");
  return { ok: true };
}
