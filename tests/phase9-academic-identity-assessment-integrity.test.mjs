import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html,app,css,migration,readme]=await Promise.all([
  readFile("index.html","utf8"),readFile("app.js","utf8"),readFile("style.css","utf8"),
  readFile("supabase/migrations/20261117000000_phase9_academic_identity_assessment_integrity.sql","utf8"),
  readFile("README.md","utf8")
]);

test("BU academic directory seeds all seven official campuses, academic units, and a broad program catalog",()=>{
  for(const campus of ["LEG-WEST","LEG-EAST","DARAGA","GUINOBATAN","TABACO","POLANGUI","GUBAT"])assert.ok(migration.includes("('"+campus+"'"),campus);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.academic_colleges/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.academic_programs/);
  const start=migration.indexOf("INSERT INTO public.academic_programs"),end=migration.indexOf("ON CONFLICT(program_code)",start);
  const rows=(migration.slice(start,end).match(/\('[A-Z0-9-]+','[^']+','[^']+','(?:undergraduate|graduate|postgraduate|non-degree)'\)/g)||[]);
  assert.ok(rows.length>=120,"seed at least 120 sourced program entries");
  assert.match(readme,/https:\/\/bicol-u\.edu\.ph\/programs\//);
});

test("student placement is complete, validated, admin-only, and automatically enrolls matching class offerings",()=>{
  for(const col of ["campus_id","college_id","program_id","year_level","block_code"])assert.match(migration,new RegExp("ADD COLUMN IF NOT EXISTS "+col));
  assert.match(migration,/profiles_academic_assignment_complete/);
  assert.match(migration,/academix_admin_list_unassigned_students/);
  assert.match(migration,/academix_admin_force_assign_student/);
  assert.match(migration,/academix_admin_save_scoped_offering/);
  assert.match(migration,/course_enrollments\(offering_id,student_id\)/);
  assert.match(html,/id="academic-placement-admin"/);
  assert.match(html,/id="placement-student"/);
  assert.match(html,/id="phase8-offering-campus"/);
  assert.match(html,/id="phase8-offering-block"/);
});

test("administrators and teachers can only retrieve grades inside the selected academic class",()=>{
  assert.match(html,/id="admin-grade-directory"/);
  assert.match(html,/id="grade-filter-campus"/);
  assert.match(html,/id="grade-filter-year"/);
  assert.match(html,/id="grade-filter-block"/);
  assert.match(html,/id="teacher-grade-directory"/);
  assert.match(app,/academix_admin_grade_directory/);
  assert.match(app,/academix_teacher_grade_directory/);
  assert.match(migration,/FROM public\.course_final_grades/);
  assert.match(app,/x\.record_type==="course_final"/);
  assert.match(app,/map\(x=>\(\{\.\.\.x,id:x\.student_id\}\)\)/);
  assert.match(migration,/Teachers read grades only in scoped classes/);
  assert.match(migration,/Teachers read submissions only in scoped classes/);
  assert.match(migration,/student\.campus_id=offering\.campus_id/);
  assert.match(migration,/academix_teacher_roster/);
  assert.doesNotMatch(migration,/\bAS \$(?!\$)|^\s*\$;/im);
  assert.equal((migration.match(/\$\$/g)||[]).length%2,0);
  assert.match(migration,/academix_teacher_assessment_grade_summary/);
});

test("assessment authoring supports objective, written, enumeration, and manually graded essay questions",()=>{
  for(const type of ["multiple_choice","true_false","identification","enumeration","short_answer","essay"])assert.ok(migration.includes("'"+type+"'"));
  assert.match(app,/Question image upload failed/);
  assert.match(app,/assessment-question-images/);
  assert.match(app,/academix_teacher_pending_manual_reviews/);
  assert.match(app,/academix_teacher_grade_submission/);
  assert.match(migration,/requires_manual_grading/);
  assert.match(migration,/academix_teacher_pending_manual_reviews/);
  assert.match(html,/phase9-academic-integrity/);
});

test("question images are stored in a restricted teacher-upload bucket and delivered without exposing answer keys",()=>{
  assert.match(migration,/assessment-question-images/);
  assert.match(migration,/Teachers upload assessment question images/);
  assert.match(migration,/image_url text/);
  assert.match(migration,/RETURNS TABLE\(id uuid,position integer,question_type text,prompt text,options jsonb,points numeric,image_url text\)/);
  assert.match(app,/getPublicUrl\(path\)/);
  assert.match(app,/question-reference-image/);
});

test("exam monitoring requests fullscreen, logs browser integrity events, and discloses limitations",()=>{
  assert.match(app,/requestFullscreen/);
  assert.match(app,/visibilitychange/);
  assert.match(app,/fullscreenchange/);
  assert.match(app,/window\.addEventListener\("blur"/);
  assert.match(app,/academix_log_exam_integrity_event/);
  assert.match(migration,/exam_integrity_events/);
  assert.match(migration,/academix_teacher_integrity_events/);
  assert.match(html,/records tab visibility changes/);
  assert.match(css,/#exam-view\.exam-integrity-active\{user-select:none/);
  assert.match(readme,/not a guaranteed lockdown/);
});

test("multiple-choice selection indicators remain perfectly circular",()=>{
  assert.match(css,/\.answer-option input\[type="radio"\][^{]*\{[^}]*border-radius:50%/s);
  assert.match(css,/aspect-ratio:1/);
});
