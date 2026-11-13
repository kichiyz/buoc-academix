-- Phase 9: academic identity, scoped grade access, richer question types, image prompts, and exam integrity events.
-- Additive migration. Existing students, course records, exams, submissions, and grades are preserved.

BEGIN;

-- Expand the supported question types without changing existing question records.
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS image_url text;

ALTER TABLE public.questions
  DROP CONSTRAINT IF EXISTS questions_question_type_check;

ALTER TABLE public.questions
  ADD CONSTRAINT questions_question_type_check
  CHECK (question_type IN (
    'multiple_choice',
    'true_false',
    'identification',
    'enumeration',
    'short_answer',
    'essay'
  ));

COMMENT ON COLUMN public.questions.image_url IS
  'Optional public reference image URL for a question prompt; never contains answer-key data.';

-- Student-facing question delivery remains SECURITY INVOKER and returns no answer key.
-- Recreate the function because PostgreSQL cannot change a RETURNS TABLE row type in place.
DROP FUNCTION IF EXISTS public.get_exam_questions(uuid);

CREATE FUNCTION public.get_exam_questions(p_exam_id uuid)
RETURNS TABLE(id uuid,"position" integer,question_type text,prompt text,options jsonb,points numeric,image_url text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT q.id, q.position, q.question_type, q.prompt, q.options, q.points, q.image_url
  FROM public.questions q
  JOIN public.exams e ON e.id = q.exam_id
  JOIN public.exam_assignments a ON a.exam_id = e.id
  WHERE q.exam_id = p_exam_id
    AND a.student_id = auth.uid()
    AND e.status = 'published'
    AND public.is_verified()
  ORDER BY q.position
$$;

-- The invoker RPC needs column-level SELECT for the image URL, not access to answer keys.
GRANT SELECT (image_url) ON public.questions TO authenticated;
REVOKE ALL ON FUNCTION public.get_exam_questions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exam_questions(uuid) TO authenticated;


CREATE TABLE IF NOT EXISTS public.academic_campuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_code text NOT NULL UNIQUE,
  campus_name text NOT NULL UNIQUE,
  city text NOT NULL,
  province text NOT NULL DEFAULT 'Albay',
  parent_campus_id uuid REFERENCES public.academic_campuses(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.academic_colleges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id uuid NOT NULL REFERENCES public.academic_campuses(id) ON DELETE RESTRICT,
  college_code text NOT NULL UNIQUE,
  college_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  UNIQUE(campus_id, college_name)
);

CREATE TABLE IF NOT EXISTS public.academic_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.academic_colleges(id) ON DELETE RESTRICT,
  program_code text NOT NULL UNIQUE,
  program_name text NOT NULL,
  degree_level text NOT NULL DEFAULT 'undergraduate'
    CHECK (degree_level IN ('undergraduate','graduate','postgraduate','non-degree')),
  catalog_source text NOT NULL DEFAULT 'BU official website',
  source_checked_on date NOT NULL DEFAULT DATE '2026-11-13',
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE(college_id, program_name)
);

INSERT INTO public.academic_campuses(campus_code,campus_name,city,province,display_order) VALUES
 ('LEG-WEST','BU Legazpi (West / Main Campus)','Legazpi City','Albay',1),
 ('LEG-EAST','BU Legazpi (East Campus)','Legazpi City','Albay',2),
 ('DARAGA','BU Daraga Campus','Daraga','Albay',3),
 ('GUINOBATAN','BU Guinobatan Campus','Guinobatan','Albay',4),
 ('TABACO','BU Tabaco Campus','Tabaco City','Albay',5),
 ('POLANGUI','BU Polangui Campus','Polangui','Albay',6),
 ('GUBAT','BU Gubat Campus','Gubat','Sorsogon',7)
ON CONFLICT(campus_code) DO UPDATE SET campus_name=excluded.campus_name,city=excluded.city,province=excluded.province;

INSERT INTO public.academic_colleges(campus_id,college_code,college_name,display_order)
SELECT c.id,v.code,v.name,v.ord
FROM (VALUES
 ('LEG-WEST','CAL','College of Arts and Letters',1),

 ('LEG-WEST','CL','College of Law',3),
 ('LEG-WEST','CM','College of Medicine',4),
 ('LEG-WEST','CN','College of Nursing',5),
 ('LEG-WEST','CS','College of Science',6),
 ('LEG-WEST','JMRIGD','Jesse M. Robredo Institute of Governance and Development',7),
 ('LEG-WEST','CDM','College of Dental Medicine',8),
 ('LEG-WEST','IPESR','Institute of Physical Education, Sports and Recreation',9),
 ('LEG-WEST','GS','Graduate School',10),
 ('LEG-WEST','OU','Open University',11),
 ('LEG-WEST','ILS','Integrated Laboratory School',12),
 ('LEG-EAST','CENG','College of Engineering',13),
 ('LEG-EAST','CIT','College of Industrial Technology',14),
 ('LEG-EAST','IDEA','Institute of Design and Architecture',15),
 ('DARAGA','CE','College of Education',16),
 ('DARAGA','CSSP','College of Social Sciences and Philosophy',17),
 ('DARAGA','CBEM','College of Business, Economics and Management',18),
 ('GUINOBATAN','BUG','BU Guinobatan',19),
 ('TABACO','BUT','BU Tabaco',20),
 ('POLANGUI','BUP','BU Polangui',21),
 ('GUBAT','BUGC','BU Gubat',22)
) AS v(campus_code,code,name,ord)
JOIN public.academic_campuses c ON c.campus_code=v.campus_code
ON CONFLICT(college_code) DO UPDATE SET college_name=excluded.college_name,campus_id=excluded.campus_id;

-- Degree programs confirmed by BU's 2025 COPC update and AY 2025-2026 admissions list.
-- Older annual-report programs are included only where BU has publicly listed them.
INSERT INTO public.academic_programs(college_id,program_code,program_name,degree_level)
SELECT col.id,v.code,v.name,v.level
FROM (VALUES
 ('CAL','BAEL','Bachelor of Arts in English Language','undergraduate'),
 ('CAL','BPAT','Bachelor of Performing Arts - Theater','undergraduate'),
 ('CAL','BAJ','Bachelor of Arts in Journalism','undergraduate'),
 ('CAL','BACOM','Bachelor of Arts in Communication','undergraduate'),
 ('CAL','BABROAD','Bachelor of Arts in Broadcasting','undergraduate'),
 ('CAL','BALIT','Bachelor of Arts in Literature','undergraduate'),
 ('CE','BECEd','Bachelor of Early Childhood Education','undergraduate'),
 ('CE','BEEd','Bachelor of Elementary Education','undergraduate'),
 ('CE','BSE','Bachelor of Secondary Education','undergraduate'),
 ('CE','BCAEd','Bachelor of Culture and Arts Education','undergraduate'),
 ('JMRIGD','BPA','Bachelor of Public Administration','undergraduate'),
 ('CN','BSN','Bachelor of Science in Nursing','undergraduate'),
 ('CENG','BSCHE','Bachelor of Science in Chemical Engineering','undergraduate'),
 ('CENG','BSCE','Bachelor of Science in Civil Engineering','undergraduate'),
 ('CENG','BSEE','Bachelor of Science in Electrical Engineering','undergraduate'),
 ('CENG','BSGE','Bachelor of Science in Geodetic Engineering','undergraduate'),
 ('CENG','BSME','Bachelor of Science in Mechanical Engineering','undergraduate'),
 ('CENG','BSMINE','Bachelor of Science in Mining Engineering','undergraduate'),
 ('CIT','BIndTech','Bachelor of Industrial Technology','undergraduate'),
 ('CIT','BSFT','Bachelor of Science in Food Technology','undergraduate'),
 ('CIT','BID','Bachelor of Industrial Design','undergraduate'),
 ('CIT','BTVTEd','Bachelor of Technical-Vocational Teacher Education','undergraduate'),
 ('IDEA','BSARCH','Bachelor of Science in Architecture','undergraduate'),
 ('CBEM','BSA','Bachelor of Science in Accountancy','undergraduate'),
 ('CBEM','BSECON','Bachelor of Science in Economics','undergraduate'),
 ('CBEM','BSENT','Bachelor of Science in Entrepreneurship','undergraduate'),
 ('CBEM','BSBA','Bachelor of Science in Business Administration','undergraduate'),
 ('CM','MD','Doctor of Medicine','postgraduate'),
 ('IPESR','BPEd','Bachelor of Physical Education','undergraduate'),
 ('IPESR','BSESS','Bachelor of Science in Exercise and Sports Sciences','undergraduate'),
 ('CS','BSBIO','Bachelor of Science in Biology','undergraduate'),
 ('CS','BSCHEM','Bachelor of Science in Chemistry','undergraduate'),
 ('CS','BSCS','Bachelor of Science in Computer Science','undergraduate'),
 ('CS','BSIT','Bachelor of Science in Information Technology','undergraduate'),
 ('CS','BSMET','Bachelor of Science in Meteorology','undergraduate'),
 ('BUG','BSAGRIBUS','Bachelor of Science in Agribusiness','undergraduate'),
 ('BUG','BSAGRI','Bachelor of Science in Agriculture','undergraduate'),
 ('BUG','BSFORESTRY','Bachelor of Science in Forestry','undergraduate'),
 ('BUG','BSDEVCOMM','Bachelor of Science in Development Communication','undergraduate'),
 ('BUG','BSABENG','Bachelor of Science in Agricultural and Biosystems Engineering','undergraduate'),
 ('BUG','BAGTECH','Bachelor of Agricultural Technology','undergraduate'),
 ('BUG','DVM','Doctor of Veterinary Medicine','postgraduate'),
 ('BUT','BSFISH','Bachelor of Science in Fisheries','undergraduate'),
 ('BUT','BSSW','Bachelor of Science in Social Work','undergraduate'),
 ('BUT','BSENT-TAB','Bachelor of Science in Entrepreneurship','undergraduate'),
 ('BUP','BSCPE','Bachelor of Science in Computer Engineering','undergraduate'),
 ('BUP','BSCS-POL','Bachelor of Science in Computer Science','undergraduate'),
 ('BUP','BSIT-POL','Bachelor of Science in Information Technology','undergraduate'),
 ('BUP','BSECE','Bachelor of Science in Electronics Engineering','undergraduate'),
 ('BUP','BSET-ELECT','Bachelor of Science in Electrical Technology','undergraduate'),
 ('BUP','BSET-ELECTRON','Bachelor of Science in Electronics Technology','undergraduate'),
 ('BUP','BSET-MECH','Bachelor of Science in Mechanical Technology','undergraduate'),
 ('BUP','BSET-AUTO','Bachelor of Science in Automotive Technology','undergraduate'),
 ('BUP','BSIS','Bachelor of Science in Information Systems','undergraduate'),
 ('BUP','BSIT-ANIM','Bachelor of Science in Information Technology (Animation)','undergraduate'),
 ('BUP','BTLED','Bachelor of Technology and Livelihood Education','undergraduate'),
 ('BUGC','BSE-FIL','Bachelor of Secondary Education major in Filipino','undergraduate'),
 ('BUGC','BSE-SS','Bachelor of Secondary Education major in Social Studies','undergraduate'),
 ('BUGC','BSBA-MICRO-G','Bachelor of Science in Business Administration major in Microfinance','undergraduate')
 ,
 ('CSSP','BAPS','Bachelor of Arts in Peace Studies','undergraduate'),
 ('CSSP','BAPHIL','Bachelor of Arts in Philosophy','undergraduate'),
 ('CSSP','BAPOLS','Bachelor of Arts in Political Science','undergraduate'),
 ('CSSP','BASOC','Bachelor of Arts in Sociology','undergraduate'),
 ('CSSP','BSPSY','Bachelor of Science in Psychology','undergraduate'),
 ('CSSP','BSSW-D','Bachelor of Science in Social Work','undergraduate'),
 ('CE','BSE-ENG','Bachelor of Secondary Education major in English','undergraduate'),
 ('CE','BSE-FIL-CE','Bachelor of Secondary Education major in Filipino','undergraduate'),
 ('CE','BSE-MATH','Bachelor of Secondary Education major in Mathematics','undergraduate'),
 ('CE','BSE-SCI','Bachelor of Secondary Education major in Science','undergraduate'),
 ('CE','BSE-SS-CE','Bachelor of Secondary Education major in Social Studies','undergraduate'),
 ('CE','BSE-VE','Bachelor of Secondary Education major in Values Education','undergraduate'),
 ('CIT','BIND-AUTO','BIndTech major in Automotive Technology','undergraduate'),
 ('CIT','BIND-CONST','BIndTech major in Construction Technology','undergraduate'),
 ('CIT','BIND-ELEC','BIndTech major in Electrical Technology','undergraduate'),
 ('CIT','BIND-ELX','BIndTech major in Electronics Technology','undergraduate'),
 ('CIT','BIND-MECH','BIndTech major in Mechanical Technology','undergraduate'),
 ('CIT','BTVT-DRAFT','BTVTEd major in Drafting Technology','undergraduate'),
 ('CIT','BTVT-ELECT','BTVTEd major in Electrical Technology','undergraduate'),
 ('CIT','BTVT-FOOD','BTVTEd major in Food and Service Management','undergraduate'),
 ('CIT','BTVT-GARMENT','BTVTEd major in Garments Fashion and Design','undergraduate'),
 ('IPESR','BSESS-COACH','BSESS major in Fitness and Sports Coaching','undergraduate'),
 ('IPESR','BSESS-MGMT','BSESS major in Fitness and Sports Management','undergraduate'),
 ('CBEM','BSBA-FM','BSBA major in Financial Management','undergraduate'),
 ('CBEM','BSBA-HRM','BSBA major in Human Resource Management','undergraduate'),
 ('CBEM','BSBA-MGMT','BSBA major in Management','undergraduate'),
 ('CBEM','BSBA-MKT','BSBA major in Marketing Management','undergraduate'),
 ('CBEM','BSBA-MICRO','BSBA major in Microfinance','undergraduate'),
 ('CBEM','BSBA-OPS','BSBA major in Operations Management','undergraduate'),
 ('CDM','DMD','Doctor of Dental Medicine','postgraduate'),
 ('CL','JD','Juris Doctor','postgraduate'),
 ('BUG','BTVT-ANIMAL','BTVTEd major in Animal Production','undergraduate'),
 ('BUG','BTVT-CROP','BTVTEd major in Agricultural Crop Production','undergraduate'),
 ('BUG','BSFT-GUIN','Bachelor of Science in Food Technology','undergraduate'),
 ('BUT','BSE-MATH-T','Bachelor of Secondary Education major in Mathematics','undergraduate'),
 ('BUT','BSE-SCI-T','Bachelor of Secondary Education major in Science','undergraduate'),
 ('BUT','BSFT-TAB','Bachelor of Science in Food Technology','undergraduate'),
 ('BUT','BSN-TAB','Bachelor of Science in Nursing','undergraduate'),
 ('BUP','BSE-ENG-P','Bachelor of Secondary Education major in English','undergraduate'),
 ('BUP','BSE-MATH-P','Bachelor of Secondary Education major in Mathematics','undergraduate'),
 ('BUP','BSENT-POL','Bachelor of Science in Entrepreneurship','undergraduate'),
 ('BUP','BSN-POL','Bachelor of Science in Nursing','undergraduate'),
 ('BUP','BTLED-ICT','Bachelor of Technology and Livelihood Education major in ICT','undergraduate'),
 ('BUP','BTLED-HE','Bachelor of Technology and Livelihood Education major in Home Economics','undergraduate'),
 ('BUGC','BEED-GUB','Bachelor of Elementary Education','undergraduate'),
 ('BUGC','BSENT-GEN','Bachelor of Science in Entrepreneurship - General Track','undergraduate'),
 ('BUGC','BSENT-AGRI','Bachelor of Science in Entrepreneurship - Agribusiness Track','undergraduate'),
 ('GS','DEdELM','Doctor of Education in Educational Leadership and Management','graduate'),
 ('GS','PhD-EF','Doctor of Philosophy in Educational Foundations','graduate'),
 ('GS','PhD-ME','Doctor of Philosophy in Mathematics Education','graduate'),
 ('GS','PhD-FIL','Doctor of Philosophy in Filipino','graduate'),
 ('GS','PhD-PA','Doctor of Philosophy in Public Administration','graduate'),
 ('GS','PhD-DM','Doctor of Philosophy in Development Management','graduate'),
 ('GS','PhD-PSA','Doctor of Philosophy in Peace and Security Administration','graduate'),
 ('GS','MA-ELM','Master of Arts in Educational Leadership and Management','graduate'),
 ('GS','MA-BIOED','Master of Arts in Biology Education','graduate'),
 ('GS','MA-CHEMED','Master of Arts in Chemistry Education','graduate'),
 ('GS','MA-ENGED','Master of Arts in English Education','graduate'),
 ('GS','MA-GC','Master of Arts in Guidance and Counseling','graduate'),
 ('GS','MA-MATHED','Master of Arts in Mathematics Education','graduate'),
 ('GS','MM','Master in Management','graduate'),
 ('GS','MPA','Master of Public Administration','graduate'),
 ('GS','MS-AGRI','Master of Science in Agriculture','graduate'),
 ('GS','MS-BIO','Master of Science in Biology','graduate'),
 ('GS','MS-FISH','Master of Science in Fisheries','graduate'),
 ('GS','MS-IS','Master in Information Systems','graduate')
) AS v(college_code,code,name,level)
JOIN public.academic_colleges col ON col.college_code=v.college_code
ON CONFLICT(program_code) DO UPDATE SET program_name=excluded.program_name,college_id=excluded.college_id,degree_level=excluded.degree_level;

-- Add explicit student placement. Existing records remain unassigned until verified by an administrator.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS campus_id uuid REFERENCES public.academic_campuses(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS college_id uuid REFERENCES public.academic_colleges(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES public.academic_programs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS year_level smallint,
  ADD COLUMN IF NOT EXISTS block_code text,
  ADD COLUMN IF NOT EXISTS academic_assignment_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS academic_assignment_updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_academic_assignment_complete;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_academic_assignment_complete CHECK (
  (campus_id IS NULL AND college_id IS NULL AND program_id IS NULL AND year_level IS NULL AND block_code IS NULL)
  OR
  (campus_id IS NOT NULL AND college_id IS NOT NULL AND program_id IS NOT NULL
   AND year_level BETWEEN 1 AND 7 AND block_code IS NOT NULL
   AND char_length(trim(block_code)) BETWEEN 1 AND 20)
);

ALTER TABLE public.course_offerings
  ADD COLUMN IF NOT EXISTS campus_id uuid REFERENCES public.academic_campuses(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS college_id uuid REFERENCES public.academic_colleges(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS program_id uuid REFERENCES public.academic_programs(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS year_level smallint,
  ADD COLUMN IF NOT EXISTS block_code text;


ALTER TABLE public.course_offerings DROP CONSTRAINT IF EXISTS course_offerings_term_id_course_id_section_key;
CREATE UNIQUE INDEX IF NOT EXISTS course_offerings_legacy_section_unique
  ON public.course_offerings(term_id,course_id,section) WHERE campus_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS course_offerings_scoped_class_unique
  ON public.course_offerings(term_id,course_id,campus_id,college_id,program_id,year_level,block_code)
  WHERE campus_id IS NOT NULL;

ALTER TABLE public.course_offerings DROP CONSTRAINT IF EXISTS course_offerings_academic_scope_complete;
ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_academic_scope_complete CHECK (
  (campus_id IS NULL AND college_id IS NULL AND program_id IS NULL AND year_level IS NULL AND block_code IS NULL)
  OR
  (campus_id IS NOT NULL AND college_id IS NOT NULL AND program_id IS NOT NULL
   AND year_level BETWEEN 1 AND 7 AND block_code IS NOT NULL
   AND char_length(trim(block_code)) BETWEEN 1 AND 20)
);

CREATE OR REPLACE FUNCTION public.academix_validate_profile_academic_placement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.campus_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.academic_campuses ca
    JOIN public.academic_colleges co ON co.campus_id=ca.id
    JOIN public.academic_programs pr ON pr.college_id=co.id
    WHERE ca.id=NEW.campus_id AND co.id=NEW.college_id AND pr.id=NEW.program_id
      AND ca.is_active AND co.is_active AND pr.is_active
  ) THEN RAISE EXCEPTION 'Student campus, college, and degree program must match the official academic directory.' USING errcode='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profiles_validate_academic_placement ON public.profiles;
CREATE TRIGGER profiles_validate_academic_placement BEFORE INSERT OR UPDATE OF campus_id,college_id,program_id,year_level,block_code
ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.academix_validate_profile_academic_placement();

CREATE OR REPLACE FUNCTION public.academix_validate_offering_academic_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.campus_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.academic_campuses ca
    JOIN public.academic_colleges co ON co.campus_id=ca.id
    JOIN public.academic_programs pr ON pr.college_id=co.id
    WHERE ca.id=NEW.campus_id AND co.id=NEW.college_id AND pr.id=NEW.program_id
      AND ca.is_active AND co.is_active AND pr.is_active
  ) THEN RAISE EXCEPTION 'Course offering campus, college, and program must match the academic directory.' USING errcode='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS course_offerings_validate_academic_scope ON public.course_offerings;
CREATE TRIGGER course_offerings_validate_academic_scope BEFORE INSERT OR UPDATE OF campus_id,college_id,program_id,year_level,block_code
ON public.course_offerings FOR EACH ROW EXECUTE FUNCTION public.academix_validate_offering_academic_scope();
REVOKE ALL ON FUNCTION public.academix_validate_profile_academic_placement() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.academix_validate_offering_academic_scope() FROM PUBLIC,anon,authenticated;

CREATE INDEX IF NOT EXISTS profiles_academic_scope_idx
  ON public.profiles(campus_id,college_id,program_id,year_level,block_code) WHERE role='student';
CREATE INDEX IF NOT EXISTS course_offerings_academic_scope_idx
  ON public.course_offerings(campus_id,college_id,program_id,year_level,block_code,term_id);

ALTER TABLE public.academic_campuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_colleges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_programs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.academic_campuses,public.academic_colleges,public.academic_programs FROM anon,authenticated;
GRANT SELECT ON public.academic_campuses,public.academic_colleges,public.academic_programs TO authenticated;
DROP POLICY IF EXISTS "Verified users read campus directory" ON public.academic_campuses;
CREATE POLICY "Verified users read campus directory" ON public.academic_campuses FOR SELECT TO authenticated USING (public.is_verified());
DROP POLICY IF EXISTS "Verified users read college directory" ON public.academic_colleges;
CREATE POLICY "Verified users read college directory" ON public.academic_colleges FOR SELECT TO authenticated USING (public.is_verified());
DROP POLICY IF EXISTS "Verified users read program directory" ON public.academic_programs;
CREATE POLICY "Verified users read program directory" ON public.academic_programs FOR SELECT TO authenticated USING (public.is_verified());

CREATE OR REPLACE FUNCTION public.academix_admin_list_unassigned_students()
RETURNS TABLE(student_id uuid,full_name text,bu_id text,email text,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.academix_is_active_admin() THEN RAISE EXCEPTION 'Administrator access required.' USING errcode='42501'; END IF;
  RETURN QUERY
    SELECT p.id,p.full_name,p.bu_id,u.email,p.created_at
    FROM public.profiles p JOIN auth.users u ON u.id=p.id
    WHERE p.role='student'::public.app_role AND p.suspended_at IS NULL
      AND (p.campus_id IS NULL OR p.college_id IS NULL OR p.program_id IS NULL OR p.year_level IS NULL OR p.block_code IS NULL)
    ORDER BY p.full_name;
END $$;

CREATE OR REPLACE FUNCTION public.academix_admin_force_assign_student(
  p_student_id uuid,p_campus_id uuid,p_college_id uuid,p_program_id uuid,
  p_year_level smallint,p_block_code text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_student public.profiles%rowtype; v_count integer;
BEGIN
  IF NOT public.academix_is_active_admin() THEN RAISE EXCEPTION 'Administrator access required.' USING errcode='42501'; END IF;
  SELECT * INTO v_student FROM public.profiles WHERE id=p_student_id AND role='student'::public.app_role AND suspended_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student account not found.' USING errcode='P0002'; END IF;
  IF p_year_level NOT BETWEEN 1 AND 7 OR char_length(trim(coalesce(p_block_code,''))) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Select a valid year level and block.' USING errcode='22023';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.academic_colleges c JOIN public.academic_programs p ON p.college_id=c.id
    WHERE c.id=p_college_id AND c.campus_id=p_campus_id AND p.id=p_program_id AND c.is_active AND p.is_active
  ) THEN RAISE EXCEPTION 'The selected campus, college, and program do not match.' USING errcode='23514'; END IF;

  UPDATE public.profiles SET campus_id=p_campus_id,college_id=p_college_id,program_id=p_program_id,
    year_level=p_year_level,block_code=upper(trim(p_block_code)),
    academic_assignment_updated_at=clock_timestamp(),academic_assignment_updated_by=auth.uid()
  WHERE id=p_student_id;

  INSERT INTO public.course_enrollments(offering_id,student_id)
  SELECT o.id,p_student_id FROM public.course_offerings o
  JOIN public.academic_terms t ON t.id=o.term_id AND t.is_active
  WHERE o.campus_id=p_campus_id AND o.college_id=p_college_id AND o.program_id=p_program_id
    AND o.year_level=p_year_level AND upper(o.block_code)=upper(trim(p_block_code))
  ON CONFLICT(offering_id,student_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('student_id',p_student_id,'enrollments_created',v_count,
    'assigned_at',clock_timestamp());
END $$;

CREATE OR REPLACE FUNCTION public.academix_admin_save_scoped_offering(
  p_term_id uuid,p_course_id uuid,p_instructor_id uuid,p_campus_id uuid,p_college_id uuid,
  p_program_id uuid,p_year_level smallint,p_section text,p_block_code text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.academix_is_active_admin() THEN RAISE EXCEPTION 'Administrator access required.' USING errcode='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_instructor_id AND role='teacher'::public.app_role
    AND verified_at IS NOT NULL AND suspended_at IS NULL) THEN
    RAISE EXCEPTION 'The assigned instructor must be an active, verified Teacher.' USING errcode='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.academic_colleges c JOIN public.academic_programs p ON p.college_id=c.id
    WHERE c.id=p_college_id AND c.campus_id=p_campus_id AND p.id=p_program_id) THEN
    RAISE EXCEPTION 'The selected academic program does not belong to the selected college and campus.' USING errcode='23514';
  END IF;
  IF p_year_level NOT BETWEEN 1 AND 7 OR char_length(trim(coalesce(p_block_code,''))) NOT BETWEEN 1 AND 20
    OR char_length(trim(coalesce(p_section,''))) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'A valid year level, block, and section label are required.' USING errcode='22023';
  END IF;
  SELECT id INTO v_id FROM public.course_offerings
  WHERE term_id=p_term_id AND course_id=p_course_id AND section=trim(p_section) AND campus_id IS NULL
  FOR UPDATE;
  IF FOUND THEN
    UPDATE public.course_offerings SET instructor_id=p_instructor_id,campus_id=p_campus_id,
      college_id=p_college_id,program_id=p_program_id,year_level=p_year_level,
      block_code=upper(trim(p_block_code))
    WHERE id=v_id;
  ELSE
    INSERT INTO public.course_offerings(term_id,course_id,instructor_id,section,campus_id,college_id,program_id,year_level,block_code)
    VALUES(p_term_id,p_course_id,p_instructor_id,trim(p_section),p_campus_id,p_college_id,p_program_id,p_year_level,upper(trim(p_block_code)))
    ON CONFLICT(term_id,course_id,campus_id,college_id,program_id,year_level,block_code)
      WHERE campus_id IS NOT NULL
    DO UPDATE SET instructor_id=excluded.instructor_id,section=excluded.section
    RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.course_enrollments(offering_id,student_id)
  SELECT v_id,p.id FROM public.profiles p WHERE p.role='student'::public.app_role
    AND p.campus_id=p_campus_id AND p.college_id=p_college_id AND p.program_id=p_program_id
    AND p.year_level=p_year_level AND upper(p.block_code)=upper(trim(p_block_code))
  ON CONFLICT(offering_id,student_id) DO NOTHING;
  RETURN v_id;
END $$;

DROP FUNCTION IF EXISTS public.academix_admin_grade_directory(uuid,uuid,uuid,smallint,text,uuid);
CREATE FUNCTION public.academix_admin_grade_directory(
  p_campus_id uuid DEFAULT NULL,p_college_id uuid DEFAULT NULL,p_program_id uuid DEFAULT NULL,
  p_year_level smallint DEFAULT NULL,p_block_code text DEFAULT NULL,p_term_id uuid DEFAULT NULL
) RETURNS TABLE(grade_id uuid,student_id uuid,full_name text,bu_id text,campus_name text,
  college_name text,program_name text,year_level smallint,block_code text,course_code text,
  course_title text,exam_title text,score numeric,max_score numeric,percentage numeric,
  record_type text,gwa_value numeric,graded_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.academix_is_active_admin() THEN RAISE EXCEPTION 'Administrator access required.' USING errcode='42501'; END IF;
  RETURN QUERY
  SELECT g.id,p.id,p.full_name,p.bu_id,ca.campus_name,co.college_name,pr.program_name,p.year_level,p.block_code,
    ac.course_code,ac.course_title,e.title,g.score,g.max_score,
    CASE WHEN g.max_score>0 THEN round(g.score/g.max_score*100,2) ELSE NULL END,
    'assessment'::text,band.gwa_value,g.created_at
  FROM public.grades g JOIN public.profiles p ON p.id=g.student_id
  JOIN public.exams e ON e.id=g.exam_id JOIN public.course_offerings o ON o.id=e.course_offering_id
  JOIN public.academic_courses ac ON ac.id=o.course_id
  LEFT JOIN public.academic_campuses ca ON ca.id=p.campus_id
  LEFT JOIN public.academic_colleges co ON co.id=p.college_id
  LEFT JOIN public.academic_programs pr ON pr.id=p.program_id
  LEFT JOIN LATERAL (
    SELECT b.gwa_value FROM public.term_grade_bands b
    WHERE b.term_id=o.term_id AND g.max_score>0 AND (g.score/g.max_score*100) BETWEEN b.min_percentage AND b.max_percentage
    ORDER BY b.min_percentage DESC LIMIT 1
  ) band ON true
  WHERE (p_campus_id IS NULL OR p.campus_id=p_campus_id)
    AND (p_college_id IS NULL OR p.college_id=p_college_id)
    AND (p_program_id IS NULL OR p.program_id=p_program_id)
    AND (p_year_level IS NULL OR p.year_level=p_year_level)
    AND (p_block_code IS NULL OR upper(p.block_code)=upper(trim(p_block_code)))
    AND (p_term_id IS NULL OR o.term_id=p_term_id)
    AND p.campus_id=o.campus_id AND p.college_id=o.college_id AND p.program_id=o.program_id
    AND p.year_level=o.year_level AND upper(p.block_code)=upper(o.block_code)
  UNION ALL
  SELECT fg.id,p.id,p.full_name,p.bu_id,ca.campus_name,co.college_name,pr.program_name,p.year_level,p.block_code,
    ac.course_code,ac.course_title,'Final course grade'::text,fg.percentage,100::numeric,fg.percentage,
    'course_final'::text,band.gwa_value,fg.finalized_at
  FROM public.course_final_grades fg
  JOIN public.course_enrollments ce ON ce.id=fg.enrollment_id
  JOIN public.profiles p ON p.id=ce.student_id
  JOIN public.course_offerings o ON o.id=ce.offering_id
  JOIN public.academic_courses ac ON ac.id=o.course_id
  LEFT JOIN public.academic_campuses ca ON ca.id=p.campus_id
  LEFT JOIN public.academic_colleges co ON co.id=p.college_id
  LEFT JOIN public.academic_programs pr ON pr.id=p.program_id
  LEFT JOIN LATERAL (
    SELECT b.gwa_value FROM public.term_grade_bands b
    WHERE b.term_id=o.term_id AND fg.percentage BETWEEN b.min_percentage AND b.max_percentage
    ORDER BY b.min_percentage DESC LIMIT 1
  ) band ON true
  WHERE (p_campus_id IS NULL OR p.campus_id=p_campus_id)
    AND (p_college_id IS NULL OR p.college_id=p_college_id)
    AND (p_program_id IS NULL OR p.program_id=p_program_id)
    AND (p_year_level IS NULL OR p.year_level=p_year_level)
    AND (p_block_code IS NULL OR upper(p.block_code)=upper(trim(p_block_code)))
    AND (p_term_id IS NULL OR o.term_id=p_term_id)
    AND p.campus_id=o.campus_id AND p.college_id=o.college_id AND p.program_id=o.program_id
    AND p.year_level=o.year_level AND upper(p.block_code)=upper(o.block_code)
  ORDER BY campus_name,college_name,program_name,year_level,block_code,full_name,graded_at DESC;
END $$;

DROP FUNCTION IF EXISTS public.academix_teacher_grade_directory(uuid);
CREATE FUNCTION public.academix_teacher_grade_directory(p_offering_id uuid)
RETURNS TABLE(grade_id uuid,student_id uuid,full_name text,bu_id text,year_level smallint,block_code text,
  course_code text,course_title text,exam_title text,score numeric,max_score numeric,percentage numeric,
  record_type text,gwa_value numeric,graded_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='teacher'::public.app_role
    AND verified_at IS NOT NULL AND suspended_at IS NULL) THEN RAISE EXCEPTION 'Verified Teacher access required.' USING errcode='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.course_offerings WHERE id=p_offering_id AND instructor_id=auth.uid()) THEN
    RAISE EXCEPTION 'You can only view grades for your assigned course offering.' USING errcode='42501';
  END IF;
  RETURN QUERY
  SELECT g.id,p.id,p.full_name,p.bu_id,p.year_level,p.block_code,ac.course_code,ac.course_title,e.title,
    g.score,g.max_score,CASE WHEN g.max_score>0 THEN round(g.score/g.max_score*100,2) ELSE NULL END,
    'assessment'::text,band.gwa_value,g.created_at
  FROM public.grades g JOIN public.profiles p ON p.id=g.student_id
  JOIN public.exams e ON e.id=g.exam_id JOIN public.course_offerings o ON o.id=e.course_offering_id
  JOIN public.academic_courses ac ON ac.id=o.course_id
  LEFT JOIN LATERAL (
    SELECT b.gwa_value FROM public.term_grade_bands b
    WHERE b.term_id=o.term_id AND g.max_score>0 AND (g.score/g.max_score*100) BETWEEN b.min_percentage AND b.max_percentage
    ORDER BY b.min_percentage DESC LIMIT 1
  ) band ON true
  WHERE o.id=p_offering_id AND p.campus_id=o.campus_id AND p.college_id=o.college_id
    AND p.program_id=o.program_id AND p.year_level=o.year_level AND upper(p.block_code)=upper(o.block_code)
  UNION ALL
  SELECT fg.id,p.id,p.full_name,p.bu_id,p.year_level,p.block_code,ac.course_code,ac.course_title,
    'Final course grade'::text,fg.percentage,100::numeric,fg.percentage,'course_final'::text,band.gwa_value,fg.finalized_at
  FROM public.course_final_grades fg JOIN public.course_enrollments ce ON ce.id=fg.enrollment_id
  JOIN public.profiles p ON p.id=ce.student_id JOIN public.course_offerings o ON o.id=ce.offering_id
  JOIN public.academic_courses ac ON ac.id=o.course_id
  LEFT JOIN LATERAL (
    SELECT b.gwa_value FROM public.term_grade_bands b
    WHERE b.term_id=o.term_id AND fg.percentage BETWEEN b.min_percentage AND b.max_percentage
    ORDER BY b.min_percentage DESC LIMIT 1
  ) band ON true
  WHERE o.id=p_offering_id AND p.campus_id=o.campus_id AND p.college_id=o.college_id
    AND p.program_id=o.program_id AND p.year_level=o.year_level AND upper(p.block_code)=upper(o.block_code)
  ORDER BY full_name,graded_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.academix_answer_matches(p_expected jsonb,p_actual jsonb,p_type text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE v_expected text; v_actual text; v_item text; v_expected_count integer; v_actual_count integer;
BEGIN
  IF p_actual IS NULL THEN RETURN false; END IF;
  IF p_type IN ('identification','short_answer') THEN
    v_actual := lower(regexp_replace(trim(coalesce(p_actual #>> '{}','')), '\s+', ' ', 'g'));
    IF jsonb_typeof(p_expected)='array' THEN
      RETURN EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_expected) x(value)
        WHERE lower(regexp_replace(trim(x.value), '\s+', ' ', 'g'))=v_actual);
    END IF;
    v_expected := lower(regexp_replace(trim(coalesce(p_expected #>> '{}','')), '\s+', ' ', 'g'));
    RETURN v_actual<>'' AND v_actual=v_expected;
  ELSIF p_type='enumeration' THEN
    IF jsonb_typeof(p_expected)<>'array' OR jsonb_typeof(p_actual)<>'array' THEN RETURN false; END IF;
    SELECT count(*) INTO v_expected_count FROM jsonb_array_elements_text(p_expected);
    SELECT count(*) INTO v_actual_count FROM jsonb_array_elements_text(p_actual);
    IF v_expected_count=0 OR v_expected_count<>v_actual_count THEN RETURN false; END IF;
    FOR v_item IN SELECT lower(regexp_replace(trim(value), '\s+', ' ', 'g')) FROM jsonb_array_elements_text(p_expected) LOOP
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_actual) a(value)
        WHERE lower(regexp_replace(trim(a.value), '\s+', ' ', 'g'))=v_item) THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  END IF;
  RETURN p_expected=p_actual;
END $$;

CREATE OR REPLACE FUNCTION public.submit_exam(p_submission_id uuid,p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_user_id uuid:=auth.uid(); v_submission public.submissions%rowtype; v_exam public.exams%rowtype;
  v_question record; v_score numeric(9,2):=0; v_max_score numeric(9,2):=0;
  v_answer jsonb; v_now timestamptz:=clock_timestamp(); v_manual boolean:=false; v_status public.submission_status;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.' USING errcode='28000'; END IF;
  IF p_answers IS NULL OR jsonb_typeof(p_answers)<>'object' THEN RAISE EXCEPTION 'Answers must be a JSON object.' USING errcode='22023'; END IF;
  SELECT * INTO v_submission FROM public.submissions WHERE id=p_submission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Submission not found.' USING errcode='P0002'; END IF;
  IF v_submission.student_id<>v_user_id THEN RAISE EXCEPTION 'You cannot submit another student’s attempt.' USING errcode='42501'; END IF;
  IF v_submission.status<>'in_progress' THEN RAISE EXCEPTION 'This attempt has already been submitted.' USING errcode='55000'; END IF;
  SELECT * INTO v_exam FROM public.exams WHERE id=v_submission.exam_id;
  IF NOT FOUND OR v_exam.status<>'published' THEN RAISE EXCEPTION 'This assessment is not available.' USING errcode='55000'; END IF;
  IF NOT public.is_verified() THEN RAISE EXCEPTION 'Institutional verification is required.' USING errcode='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.exam_assignments a WHERE a.exam_id=v_submission.exam_id AND a.student_id=v_user_id) THEN
    RAISE EXCEPTION 'You are not assigned to this assessment.' USING errcode='42501';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.profiles student JOIN public.course_offerings offering ON offering.id=v_exam.course_offering_id
    WHERE student.id=v_user_id AND student.role='student'::public.app_role
      AND student.verified_at IS NOT NULL AND student.suspended_at IS NULL
      AND student.campus_id=offering.campus_id AND student.college_id=offering.college_id
      AND student.program_id=offering.program_id AND student.year_level=offering.year_level
      AND upper(student.block_code)=upper(offering.block_code)
  ) THEN RAISE EXCEPTION 'Your student account is not assigned to this academic class.' USING errcode='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.questions q WHERE q.exam_id=v_submission.exam_id) THEN RAISE EXCEPTION 'This assessment has no questions.' USING errcode='55000'; END IF;

  FOR v_question IN SELECT q.id,q.correct_answer,q.points,q.question_type FROM public.questions q
    WHERE q.exam_id=v_submission.exam_id ORDER BY q.position LOOP
    v_max_score:=v_max_score+v_question.points;
    v_answer:=p_answers->v_question.id::text;
    IF v_question.question_type='essay' THEN
      v_manual:=true;
    ELSIF public.academix_answer_matches(v_question.correct_answer,v_answer,v_question.question_type) THEN
      v_score:=v_score+v_question.points;
    END IF;
  END LOOP;

  v_status:=CASE WHEN v_manual THEN 'submitted'::public.submission_status ELSE 'graded'::public.submission_status END;
  UPDATE public.submissions SET answers=p_answers,score=v_score,max_score=v_max_score,status=v_status,
    submitted_at=v_now,graded_at=CASE WHEN v_manual THEN NULL ELSE v_now END WHERE id=p_submission_id;

  IF NOT v_manual THEN
    INSERT INTO public.grades(submission_id,student_id,exam_id,score,max_score,feedback,graded_by,created_at)
    VALUES(p_submission_id,v_user_id,v_submission.exam_id,v_score,v_max_score,'Automatically graded',NULL,v_now)
    ON CONFLICT(submission_id) DO UPDATE SET score=excluded.score,max_score=excluded.max_score,
      feedback=excluded.feedback,graded_by=NULL,created_at=excluded.created_at;
  END IF;
  RETURN jsonb_build_object('submission_id',p_submission_id,'status',v_status,'score',v_score,
    'max_score',v_max_score,'submitted_at',v_now,'requires_manual_grading',v_manual);
END $$;
REVOKE ALL ON FUNCTION public.submit_exam(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_exam(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.academix_teacher_grade_submission(
  p_submission_id uuid,p_score numeric,p_feedback text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_sub public.submissions%rowtype; v_exam public.exams%rowtype;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='teacher'::public.app_role
    AND verified_at IS NOT NULL AND suspended_at IS NULL) THEN RAISE EXCEPTION 'Verified Teacher access required.' USING errcode='42501'; END IF;
  SELECT * INTO v_sub FROM public.submissions WHERE id=p_submission_id FOR UPDATE;
  IF NOT FOUND OR v_sub.status<>'submitted' THEN RAISE EXCEPTION 'No submitted response is awaiting manual grading.' USING errcode='P0002'; END IF;
  SELECT * INTO v_exam FROM public.exams WHERE id=v_sub.exam_id;
  IF v_exam.teacher_id<>auth.uid() THEN RAISE EXCEPTION 'You may only grade your own assessment submissions.' USING errcode='42501'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.course_offerings o JOIN public.profiles student ON student.id=v_sub.student_id
    WHERE o.id=v_exam.course_offering_id AND o.instructor_id=auth.uid()
      AND student.campus_id=o.campus_id AND student.college_id=o.college_id
      AND student.program_id=o.program_id AND student.year_level=o.year_level
      AND upper(student.block_code)=upper(o.block_code)
  ) THEN RAISE EXCEPTION 'This submission is outside your assigned academic class.' USING errcode='42501'; END IF;
  IF p_score<0 OR p_score>v_sub.max_score THEN RAISE EXCEPTION 'Score must be between 0 and the maximum points.' USING errcode='22023'; END IF;
  UPDATE public.submissions SET score=p_score,status='graded',graded_at=clock_timestamp() WHERE id=p_submission_id;
  INSERT INTO public.grades(submission_id,student_id,exam_id,score,max_score,feedback,graded_by)
  VALUES(p_submission_id,v_sub.student_id,v_sub.exam_id,p_score,v_sub.max_score,left(coalesce(p_feedback,''),1000),auth.uid())
  ON CONFLICT(submission_id) DO UPDATE SET score=excluded.score,max_score=excluded.max_score,
    feedback=excluded.feedback,graded_by=excluded.graded_by,created_at=clock_timestamp();
  RETURN jsonb_build_object('submission_id',p_submission_id,'status','graded','score',p_score,'max_score',v_sub.max_score);
END $$;

CREATE OR REPLACE FUNCTION public.academix_teacher_pending_manual_reviews(p_offering_id uuid)
RETURNS TABLE(submission_id uuid,student_name text,exam_title text,answers jsonb,questions jsonb,
  auto_score numeric,max_score numeric,submitted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.academix_is_active_admin() THEN
    IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='teacher'::public.app_role
      AND verified_at IS NOT NULL AND suspended_at IS NULL)
      OR NOT EXISTS(SELECT 1 FROM public.course_offerings WHERE id=p_offering_id AND instructor_id=auth.uid()) THEN
      RAISE EXCEPTION 'You may only review submissions for your assigned course offering.' USING errcode='42501';
    END IF;
  END IF;
  RETURN QUERY
  SELECT s.id,p.full_name,e.title,s.answers,
    (SELECT jsonb_agg(jsonb_build_object('id',q.id,'prompt',q.prompt,'question_type',q.question_type,'points',q.points)
      ORDER BY q.position) FROM public.questions q WHERE q.exam_id=e.id),
    s.score,s.max_score,s.submitted_at
  FROM public.submissions s JOIN public.exams e ON e.id=s.exam_id
  JOIN public.profiles p ON p.id=s.student_id
  JOIN public.course_offerings o ON o.id=e.course_offering_id
  WHERE e.course_offering_id=p_offering_id AND s.status='submitted'
    AND p.campus_id=o.campus_id AND p.college_id=o.college_id AND p.program_id=o.program_id
    AND p.year_level=o.year_level AND upper(p.block_code)=upper(o.block_code)
    AND EXISTS(SELECT 1 FROM public.questions q WHERE q.exam_id=e.id AND q.question_type='essay')
  ORDER BY s.submitted_at;
END $$;

CREATE TABLE IF NOT EXISTS public.exam_integrity_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK(event_type IN ('tab_hidden','fullscreen_exit','window_blur')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS exam_integrity_events_submission_idx ON public.exam_integrity_events(submission_id,occurred_at);
ALTER TABLE public.exam_integrity_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exam_integrity_events FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.academix_log_exam_integrity_event(
  p_submission_id uuid,p_event_type text,p_details jsonb DEFAULT '{}'::jsonb
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_sub public.submissions%rowtype; v_id bigint;
BEGIN
  IF p_event_type NOT IN ('tab_hidden','fullscreen_exit','window_blur') THEN RAISE EXCEPTION 'Unsupported integrity event.' USING errcode='22023'; END IF;
  SELECT * INTO v_sub FROM public.submissions WHERE id=p_submission_id AND student_id=auth.uid() AND status='in_progress';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active exam attempt not found.' USING errcode='42501'; END IF;
  INSERT INTO public.exam_integrity_events(submission_id,exam_id,student_id,event_type,details)
  VALUES(v_sub.id,v_sub.exam_id,v_sub.student_id,p_event_type,
    CASE WHEN jsonb_typeof(p_details)='object' THEN p_details ELSE '{}'::jsonb END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.academix_teacher_integrity_events(p_offering_id uuid)
RETURNS TABLE(event_id bigint,student_name text,exam_title text,event_type text,occurred_at timestamptz,details jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.academix_is_active_admin() THEN
    IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='teacher'::public.app_role
      AND verified_at IS NOT NULL AND suspended_at IS NULL)
      OR NOT EXISTS(SELECT 1 FROM public.course_offerings WHERE id=p_offering_id AND instructor_id=auth.uid()) THEN
      RAISE EXCEPTION 'You may only view integrity events for your assigned course offering.' USING errcode='42501';
    END IF;
  END IF;
  RETURN QUERY SELECT ev.id,p.full_name,e.title,ev.event_type,ev.occurred_at,ev.details
  FROM public.exam_integrity_events ev JOIN public.profiles p ON p.id=ev.student_id
  JOIN public.exams e ON e.id=ev.exam_id JOIN public.course_offerings o ON o.id=e.course_offering_id
  WHERE e.course_offering_id=p_offering_id
    AND p.campus_id=o.campus_id AND p.college_id=o.college_id AND p.program_id=o.program_id
    AND p.year_level=o.year_level AND upper(p.block_code)=upper(o.block_code)
  ORDER BY ev.occurred_at DESC LIMIT 200;
END $$;

REVOKE ALL ON FUNCTION public.academix_admin_list_unassigned_students() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_admin_force_assign_student(uuid,uuid,uuid,uuid,smallint,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_admin_save_scoped_offering(uuid,uuid,uuid,uuid,uuid,uuid,smallint,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_admin_grade_directory(uuid,uuid,uuid,smallint,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_teacher_grade_directory(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_teacher_grade_submission(uuid,numeric,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_teacher_pending_manual_reviews(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_log_exam_integrity_event(uuid,text,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.academix_teacher_integrity_events(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.academix_admin_list_unassigned_students() TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_admin_force_assign_student(uuid,uuid,uuid,uuid,smallint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_admin_save_scoped_offering(uuid,uuid,uuid,uuid,uuid,uuid,smallint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_admin_grade_directory(uuid,uuid,uuid,smallint,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_teacher_grade_directory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_teacher_grade_submission(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_teacher_pending_manual_reviews(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_log_exam_integrity_event(uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academix_teacher_integrity_events(uuid) TO authenticated;

-- Images are public reference material; only active Teachers may upload to their own folder.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('assessment-question-images','assessment-question-images',true,5242880,
  ARRAY['image/png','image/jpeg','image/webp','image/gif']::text[])
ON CONFLICT(id) DO UPDATE SET public=true,file_size_limit=5242880,
  allowed_mime_types=ARRAY['image/png','image/jpeg','image/webp','image/gif']::text[];
DROP POLICY IF EXISTS "Teachers upload assessment question images" ON storage.objects;
CREATE POLICY "Teachers upload assessment question images" ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='assessment-question-images'
  AND (storage.foldername(name))[1]=auth.uid()::text
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid()
    AND p.role='teacher'::public.app_role AND p.verified_at IS NOT NULL AND p.suspended_at IS NULL));
DROP POLICY IF EXISTS "Teachers update own assessment question images" ON storage.objects;
CREATE POLICY "Teachers update own assessment question images" ON storage.objects FOR UPDATE TO authenticated
USING(bucket_id='assessment-question-images' AND (storage.foldername(name))[1]=auth.uid()::text)
WITH CHECK(bucket_id='assessment-question-images' AND (storage.foldername(name))[1]=auth.uid()::text);
DROP POLICY IF EXISTS "Teachers delete own assessment question images" ON storage.objects;
CREATE POLICY "Teachers delete own assessment question images" ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='assessment-question-images' AND (storage.foldername(name))[1]=auth.uid()::text);

COMMENT ON TABLE public.academic_programs IS 'Bicol University degree-program directory; entries are sourced from BU official public program listings and require registrar confirmation for current availability.';
COMMENT ON TABLE public.exam_integrity_events IS 'Transparent browser-side exam integrity event log. Events are indicators for instructor review, not proof of misconduct.';
COMMENT ON COLUMN public.questions.image_url IS 'Optional public reference image for a question prompt.';
COMMENT ON COLUMN public.profiles.program_id IS 'Student degree program / course assignment.';

CREATE OR REPLACE FUNCTION public.academix_teacher_publish_course_assessment(p_exam_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exam public.exams%rowtype;
  v_archived integer := 0;
  v_assigned integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_verified() OR EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND suspended_at IS NOT NULL)
     OR (SELECT role FROM public.profiles WHERE id = auth.uid())
        IS DISTINCT FROM 'teacher'::public.app_role THEN
    RAISE EXCEPTION 'Verified Teacher account required.' USING errcode = '42501';
  END IF;

  SELECT * INTO v_exam
  FROM public.exams
  WHERE id = p_exam_id AND teacher_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assessment not found or not owned by this teacher.' USING errcode = '42501';
  END IF;

  IF v_exam.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft assessment can be published.' USING errcode = '55000';
  END IF;

  IF v_exam.course_offering_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.course_offerings o
    WHERE o.id = v_exam.course_offering_id AND o.instructor_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Select one of your assigned course offerings before publishing.' USING errcode = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.questions WHERE exam_id = p_exam_id) THEN
    RAISE EXCEPTION 'Add at least one question before publishing.' USING errcode = '23514';
  END IF;

  IF v_exam.assessment_category = 'midterm' THEN
    UPDATE public.exams SET grade_weight_percent = 20 WHERE id = p_exam_id;
  ELSIF v_exam.assessment_category = 'final' THEN
    UPDATE public.exams SET grade_weight_percent = 25 WHERE id = p_exam_id;
  ELSIF COALESCE(v_exam.grade_weight_percent, 0) <= 0 THEN
    RAISE EXCEPTION 'Coursework assessments need a relative weight greater than zero.' USING errcode = '23514';
  END IF;

  IF v_exam.assessment_category IN ('midterm','final') THEN
    UPDATE public.exams
    SET status = 'archived'
    WHERE course_offering_id = v_exam.course_offering_id
      AND assessment_category = v_exam.assessment_category
      AND status = 'published'
      AND id <> p_exam_id
      AND teacher_id = auth.uid();
    GET DIAGNOSTICS v_archived = ROW_COUNT;
  END IF;

  INSERT INTO public.exam_assignments(exam_id, student_id)
  SELECT p_exam_id, e.student_id
  FROM public.course_enrollments e
  JOIN public.profiles student ON student.id=e.student_id
  JOIN public.course_offerings offering ON offering.id=e.offering_id
  WHERE e.offering_id = v_exam.course_offering_id
    AND student.campus_id=offering.campus_id AND student.college_id=offering.college_id
    AND student.program_id=offering.program_id AND student.year_level=offering.year_level
    AND upper(student.block_code)=upper(offering.block_code)
  ON CONFLICT (exam_id, student_id) DO NOTHING;
  GET DIAGNOSTICS v_assigned = ROW_COUNT;

  UPDATE public.exams
  SET status = 'published', published_at = now()
  WHERE id = p_exam_id;

  RETURN jsonb_build_object(
    'exam_id', p_exam_id,
    'archived_replacements', v_archived,
    'assigned_students', v_assigned
  );
END;
$$;

create or replace function public.academix_teacher_roster(p_offering_id uuid)
returns table(enrollment_id uuid,student_id uuid,student_name text,bu_id text,percentage numeric,remarks text)
language plpgsql stable security definer set search_path=public,pg_temp AS $$
begin
  if auth.uid() is null or not public.is_verified()
    or (select role from public.profiles where id=auth.uid()) is distinct from 'teacher'::public.app_role
    or exists(select 1 from public.profiles where id=auth.uid() and suspended_at is not null) then
    raise exception 'Verified Teacher access required.' using errcode='42501';
  end if;
  if not exists(select 1 from public.course_offerings where id=p_offering_id and instructor_id=auth.uid()) then
    raise exception 'This course offering is not assigned to your account.' using errcode='42501';
  end if;
  return query
  select e.id,e.student_id,coalesce(p.full_name,'Student'),p.bu_id,fg.percentage,fg.remarks
  from public.course_enrollments e
  join public.profiles p on p.id=e.student_id
  join public.course_offerings o on o.id=e.offering_id
  left join public.course_final_grades fg on fg.enrollment_id=e.id
  where e.offering_id=p_offering_id
    and p.campus_id=o.campus_id and p.college_id=o.college_id and p.program_id=o.program_id
    and p.year_level=o.year_level and upper(p.block_code)=upper(o.block_code)
  order by p.full_name;
end $$;

CREATE OR REPLACE FUNCTION public.academix_teacher_assessment_grade_summary(p_offering_id uuid)
RETURNS TABLE(
  enrollment_id uuid,
  student_id uuid,
  midterm_percentage numeric,
  midterm_gwa numeric,
  final_percentage numeric,
  final_gwa numeric,
  coursework_percentage numeric,
  computed_final_percentage numeric,
  computed_final_gwa numeric,
  missing_coursework_assessments integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_verified()
     OR (SELECT role FROM public.profiles WHERE id = auth.uid()) IS DISTINCT FROM 'teacher'::public.app_role
     OR EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND suspended_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Verified Teacher account required.' USING errcode = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.course_offerings o
    WHERE o.id = p_offering_id AND o.instructor_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'This course offering is not assigned to your account.' USING errcode = '42501';
  END IF;

  RETURN QUERY
  WITH offering AS (
    SELECT o.id,o.term_id,o.campus_id,o.college_id,o.program_id,o.year_level,o.block_code FROM public.course_offerings o WHERE o.id=p_offering_id
  ),
  active_exams AS (
    SELECT e.id, e.assessment_category, COALESCE(e.grade_weight_percent, 1)::numeric AS weight
    FROM public.exams e
    WHERE e.course_offering_id = p_offering_id
      AND e.status = 'published'
  ),
  latest_attempt AS (
    SELECT DISTINCT ON (s.exam_id, s.student_id)
      s.exam_id, s.student_id,
      CASE WHEN s.max_score > 0 THEN (s.score / s.max_score) * 100 ELSE NULL END AS percentage
    FROM public.submissions s
    JOIN active_exams e ON e.id = s.exam_id
    WHERE s.status = 'graded' AND s.score IS NOT NULL AND s.max_score > 0
    ORDER BY s.exam_id, s.student_id, s.attempt_number DESC, s.submitted_at DESC
  ),
  by_student AS (
    SELECT
      ce.id AS enrollment_id,
      ce.student_id,
      MAX(la.percentage) FILTER (WHERE ae.assessment_category = 'midterm') AS midterm_pct,
      MAX(la.percentage) FILTER (WHERE ae.assessment_category = 'final') AS final_pct,
      CASE
        WHEN COUNT(*) FILTER (
          WHERE ae.assessment_category NOT IN ('midterm','final')
        ) > 0
         AND COUNT(la.percentage) FILTER (
          WHERE ae.assessment_category NOT IN ('midterm','final')
        ) = COUNT(*) FILTER (
          WHERE ae.assessment_category NOT IN ('midterm','final')
        )
         AND SUM(ae.weight) FILTER (
          WHERE ae.assessment_category NOT IN ('midterm','final')
        ) > 0
        THEN SUM(la.percentage * ae.weight) FILTER (
          WHERE ae.assessment_category NOT IN ('midterm','final')
        ) / NULLIF(SUM(ae.weight) FILTER (
          WHERE ae.assessment_category NOT IN ('midterm','final')
        ), 0)
        ELSE NULL
      END AS coursework_pct,
      COUNT(*) FILTER (
        WHERE ae.assessment_category NOT IN ('midterm','final')
          AND la.percentage IS NULL
      )::integer AS missing_coursework
    FROM public.course_enrollments ce
    JOIN public.profiles student ON student.id=ce.student_id
    CROSS JOIN offering scoped
    LEFT JOIN active_exams ae ON true
    LEFT JOIN latest_attempt la
      ON la.exam_id = ae.id AND la.student_id = ce.student_id
    WHERE ce.offering_id = p_offering_id
      AND student.campus_id=scoped.campus_id AND student.college_id=scoped.college_id
      AND student.program_id=scoped.program_id AND student.year_level=scoped.year_level
      AND upper(student.block_code)=upper(scoped.block_code)
    GROUP BY ce.id, ce.student_id
  ),
  calculated AS (
    SELECT
      b.*,
      CASE
        WHEN b.midterm_pct IS NOT NULL
         AND b.final_pct IS NOT NULL
         AND b.coursework_pct IS NOT NULL
         AND b.missing_coursework = 0
        THEN ROUND(b.midterm_pct * 0.20 + b.final_pct * 0.25 + b.coursework_pct * 0.55, 2)
        ELSE NULL
      END AS final_pct
    FROM by_student b
  )
  SELECT
    c.enrollment_id,
    c.student_id,
    ROUND(c.midterm_pct,2),
    mb.gwa_value,
    ROUND(c.final_pct,2),
    fb.gwa_value,
    ROUND(c.coursework_pct,2),
    c.final_pct,
    final_band.gwa_value,
    c.missing_coursework
  FROM calculated c
  CROSS JOIN offering o
  LEFT JOIN LATERAL (
    SELECT b.gwa_value FROM public.term_grade_bands b
    WHERE b.term_id = o.term_id AND c.midterm_pct BETWEEN b.min_percentage AND b.max_percentage
    ORDER BY b.min_percentage DESC LIMIT 1
  ) mb ON true
  LEFT JOIN LATERAL (
    SELECT b.gwa_value FROM public.term_grade_bands b
    WHERE b.term_id = o.term_id AND c.final_pct BETWEEN b.min_percentage AND b.max_percentage
    ORDER BY b.min_percentage DESC LIMIT 1
  ) fb ON true
  LEFT JOIN LATERAL (
    SELECT b.gwa_value FROM public.term_grade_bands b
    WHERE b.term_id = o.term_id AND c.final_pct BETWEEN b.min_percentage AND b.max_percentage
    ORDER BY b.min_percentage DESC LIMIT 1
  ) final_band ON true
  ORDER BY c.student_id;
END;
$$;

create or replace function public.start_exam_attempt(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
AS $$
declare
  v_user uuid := auth.uid();
  v_exam public.exams%rowtype;
  v_existing public.submissions%rowtype;
  v_latest integer;
  v_attempt integer;
  v_type text := 'initial';
  v_auth public.exam_attempt_authorizations%rowtype;
  v_submission uuid;
begin
  if v_user is null then raise exception 'Authentication required.' using errcode='28000'; end if;
  if not public.is_verified() then raise exception 'Institutional verification is required.' using errcode='42501'; end if;

  select * into v_exam from public.exams where id=p_exam_id and status='published';
  if not found then raise exception 'Published exam not found.' using errcode='P0002'; end if;
  if not exists(select 1 from public.exam_assignments where exam_id=p_exam_id and student_id=v_user) then
    raise exception 'You are not assigned to this assessment.' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.profiles student join public.course_offerings offering
      on offering.id=v_exam.course_offering_id
    where student.id=v_user AND student.role='student'::public.app_role AND student.verified_at IS NOT NULL AND student.suspended_at IS NULL
      AND student.campus_id=offering.campus_id AND student.college_id=offering.college_id
      AND student.program_id=offering.program_id AND student.year_level=offering.year_level
      AND upper(student.block_code)=upper(offering.block_code)
  ) then
    raise exception 'Your student account is not assigned to this academic class. Contact the administrator.' using errcode='42501';
  end if;
  if not exists(select 1 from public.questions where exam_id=p_exam_id) then
    raise exception 'This assessment has no questions.' using errcode='55000';
  end if;

  select * into v_existing from public.submissions
  where exam_id=p_exam_id and student_id=v_user and status='in_progress'
  order by attempt_number desc limit 1;
  if found then
    return jsonb_build_object('submission_id',v_existing.id,'attempt_number',v_existing.attempt_number,'attempt_type',v_existing.attempt_type);
  end if;

  select coalesce(max(attempt_number),0) into v_latest
  from public.submissions where exam_id=p_exam_id and student_id=v_user;

  if v_latest=0 then
    v_attempt := 1;
    v_type := 'initial';
  else
    select * into v_auth from public.exam_attempt_authorizations
    where exam_id=p_exam_id and student_id=v_user and consumed_at is null
    order by attempt_number asc limit 1 for update;
    if not found then raise exception 'No retake or remedial attempt is authorized.' using errcode='42501'; end if;
    v_attempt := v_auth.attempt_number;
    v_type := v_auth.attempt_type;
    update public.exam_attempt_authorizations set consumed_at=now() where id=v_auth.id;
  end if;

  insert into public.submissions(exam_id,student_id,status,attempt_number,attempt_type)
  values(p_exam_id,v_user,'in_progress',v_attempt,v_type)
  returning id into v_submission;

  return jsonb_build_object('submission_id',v_submission,'attempt_number',v_attempt,'attempt_type',v_type);
end;
$$;



CREATE OR REPLACE FUNCTION public.academix_can_read_offering(p_offering_id uuid,p_instructor_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT public.academix_is_active_admin()
    OR (p_instructor_id=auth.uid() AND EXISTS(
      SELECT 1 FROM public.profiles actor WHERE actor.id=auth.uid()
        AND actor.role='teacher'::public.app_role AND actor.verified_at IS NOT NULL AND actor.suspended_at IS NULL
    ))
    OR EXISTS(
      SELECT 1 FROM public.course_enrollments e
      JOIN public.course_offerings o ON o.id=e.offering_id
      JOIN public.profiles student ON student.id=e.student_id
      WHERE e.offering_id=p_offering_id AND e.student_id=auth.uid()
        AND student.role='student'::public.app_role AND student.verified_at IS NOT NULL AND student.suspended_at IS NULL
        AND student.campus_id=o.campus_id AND student.college_id=o.college_id
        AND student.program_id=o.program_id AND student.year_level=o.year_level
        AND upper(student.block_code)=upper(o.block_code)
    )
$$;
REVOKE ALL ON FUNCTION public.academix_can_read_offering(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.academix_can_read_offering(uuid,uuid) TO authenticated;

DROP POLICY IF EXISTS "Students instructors and admins read enrollments" ON public.course_enrollments;
CREATE POLICY "Students instructors and admins read enrollments" ON public.course_enrollments
FOR SELECT TO authenticated USING (
  student_id=auth.uid() OR public.academix_is_active_admin() OR EXISTS (
    SELECT 1 FROM public.course_offerings o JOIN public.profiles student ON student.id=course_enrollments.student_id
    JOIN public.profiles actor ON actor.id=auth.uid()
    WHERE o.id=offering_id AND o.instructor_id=auth.uid()
      AND actor.role='teacher'::public.app_role AND actor.verified_at IS NOT NULL AND actor.suspended_at IS NULL
      AND student.campus_id=o.campus_id AND student.college_id=o.college_id
      AND student.program_id=o.program_id AND student.year_level=o.year_level
      AND upper(student.block_code)=upper(o.block_code)
  )
);

DROP POLICY IF EXISTS "Students instructors and admins read final course grades" ON public.course_final_grades;
CREATE POLICY "Students instructors and admins read final course grades" ON public.course_final_grades
FOR SELECT TO authenticated USING (
  public.academix_is_active_admin() OR EXISTS (
    SELECT 1 FROM public.course_enrollments e
    JOIN public.course_offerings o ON o.id=e.offering_id
    JOIN public.profiles student ON student.id=e.student_id
    WHERE e.id=enrollment_id
      AND student.campus_id=o.campus_id AND student.college_id=o.college_id
      AND student.program_id=o.program_id AND student.year_level=o.year_level
      AND upper(student.block_code)=upper(o.block_code)
      AND (e.student_id=auth.uid() OR (o.instructor_id=auth.uid() AND public.is_verified()
        AND EXISTS(SELECT 1 FROM public.profiles actor WHERE actor.id=auth.uid()
          AND actor.role='teacher'::public.app_role AND actor.suspended_at IS NULL)))
  )
);

-- Enforce academic class boundaries at the database layer, not only in the interface.
DROP POLICY IF EXISTS "teachers manage assignments for own exams" ON public.exam_assignments;
CREATE POLICY "Teachers manage assignments only in scoped classes" ON public.exam_assignments
FOR ALL TO authenticated
USING (
  public.academix_is_active_admin()
  OR EXISTS(
    SELECT 1 FROM public.exams e JOIN public.course_offerings o ON o.id=e.course_offering_id
    JOIN public.profiles actor ON actor.id=auth.uid()
    JOIN public.profiles student ON student.id=exam_assignments.student_id
    WHERE e.id=exam_assignments.exam_id AND e.teacher_id=auth.uid()
      AND actor.role='teacher'::public.app_role AND actor.verified_at IS NOT NULL AND actor.suspended_at IS NULL
      AND student.role='student'::public.app_role AND student.campus_id=o.campus_id
      AND student.college_id=o.college_id AND student.program_id=o.program_id
      AND student.year_level=o.year_level AND upper(student.block_code)=upper(o.block_code)
  )
)
WITH CHECK (
  public.academix_is_active_admin()
  OR EXISTS(
    SELECT 1 FROM public.exams e JOIN public.course_offerings o ON o.id=e.course_offering_id
    JOIN public.profiles actor ON actor.id=auth.uid()
    JOIN public.profiles student ON student.id=exam_assignments.student_id
    WHERE e.id=exam_assignments.exam_id AND e.teacher_id=auth.uid()
      AND actor.role='teacher'::public.app_role AND actor.verified_at IS NOT NULL AND actor.suspended_at IS NULL
      AND student.role='student'::public.app_role
      AND student.campus_id=o.campus_id AND student.college_id=o.college_id
      AND student.program_id=o.program_id AND student.year_level=o.year_level
      AND upper(student.block_code)=upper(o.block_code)
  )
);

DROP POLICY IF EXISTS "teachers read submissions for own exams" ON public.submissions;
CREATE POLICY "Teachers read submissions only in scoped classes" ON public.submissions
FOR SELECT TO authenticated USING (
  EXISTS(
    SELECT 1 FROM public.exams e JOIN public.course_offerings o ON o.id=e.course_offering_id
    JOIN public.profiles actor ON actor.id=auth.uid()
    JOIN public.profiles student ON student.id=submissions.student_id
    WHERE e.id=submissions.exam_id AND e.teacher_id=auth.uid() AND o.instructor_id=auth.uid()
      AND actor.role='teacher'::public.app_role AND actor.verified_at IS NOT NULL AND actor.suspended_at IS NULL
      AND student.campus_id=o.campus_id AND student.college_id=o.college_id
      AND student.program_id=o.program_id AND student.year_level=o.year_level
      AND upper(student.block_code)=upper(o.block_code)
  )
);

DROP POLICY IF EXISTS "teachers read grades for own exams" ON public.grades;
CREATE POLICY "Teachers read grades only in scoped classes" ON public.grades
FOR SELECT TO authenticated USING (
  EXISTS(
    SELECT 1 FROM public.exams e JOIN public.course_offerings o ON o.id=e.course_offering_id
    JOIN public.profiles actor ON actor.id=auth.uid()
    JOIN public.profiles student ON student.id=grades.student_id
    WHERE e.id=grades.exam_id AND e.teacher_id=auth.uid() AND o.instructor_id=auth.uid()
      AND actor.role='teacher'::public.app_role AND actor.verified_at IS NOT NULL AND actor.suspended_at IS NULL
      AND student.campus_id=o.campus_id AND student.college_id=o.college_id
      AND student.program_id=o.program_id AND student.year_level=o.year_level
      AND upper(student.block_code)=upper(o.block_code)
  )
);


COMMIT;
