CREATE TABLE schools (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  portal_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  description text
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  role_id uuid NOT NULL REFERENCES roles(id),
  email citext NOT NULL UNIQUE,
  password_hash text,
  first_name text NOT NULL,
  last_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('invited', 'active', 'suspended', 'archived')),
  must_change_password boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE families (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  name text NOT NULL,
  emergency_contact_name text,
  emergency_contact_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guardians (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  user_id uuid NOT NULL REFERENCES users(id),
  family_id uuid NOT NULL REFERENCES families(id),
  relationship text NOT NULL,
  preferred_communication text NOT NULL DEFAULT 'email',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE students (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  user_id uuid NOT NULL REFERENCES users(id),
  family_id uuid REFERENCES families(id),
  student_number text NOT NULL UNIQUE,
  date_of_birth date,
  gender text,
  phone text,
  address text,
  enrollment_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'paused', 'graduated', 'withdrawn', 'archived')),
  level text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE instructors (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('active', 'inactive', 'archived')),
  bio text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guardian_students (
  guardian_id uuid NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  can_receive_notifications boolean NOT NULL DEFAULT true,
  PRIMARY KEY (guardian_id, student_id)
);

CREATE TABLE academic_years (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  UNIQUE (school_id, name)
);

CREATE TABLE programs (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  name text NOT NULL,
  description text
);

CREATE TABLE courses (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  program_id uuid REFERENCES programs(id),
  name text NOT NULL,
  description text,
  level text,
  duration_weeks integer,
  curriculum jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE classes (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  academic_year_id uuid REFERENCES academic_years(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  instructor_id uuid REFERENCES instructors(id),
  name text NOT NULL,
  schedule jsonb NOT NULL DEFAULT '{}'::jsonb,
  classroom text,
  starts_on date,
  ends_on date,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enrollments (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id),
  class_id uuid NOT NULL REFERENCES classes(id),
  status text NOT NULL CHECK (status IN ('active', 'completed', 'dropped')),
  enrolled_on date NOT NULL,
  UNIQUE (student_id, class_id)
);

CREATE TABLE attendance_records (
  id uuid PRIMARY KEY,
  class_id uuid NOT NULL REFERENCES classes(id),
  student_id uuid NOT NULL REFERENCES students(id),
  taken_by_user_id uuid NOT NULL REFERENCES users(id),
  attendance_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('present', 'late', 'absent', 'excused')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, student_id, attendance_date)
);

CREATE TABLE assignments (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  class_id uuid NOT NULL REFERENCES classes(id),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  description text,
  instructions text,
  due_at timestamptz,
  difficulty text,
  max_grade numeric(8,2) NOT NULL DEFAULT 100,
  visibility text NOT NULL DEFAULT 'class',
  status text NOT NULL CHECK (status IN ('draft', 'published', 'closed', 'archived')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assignment_submissions (
  id uuid PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES assignments(id),
  student_id uuid NOT NULL REFERENCES students(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('submitted', 'returned', 'late', 'graded')),
  content text,
  grade numeric(8,2),
  feedback text,
  graded_by_user_id uuid REFERENCES users(id),
  graded_at timestamptz,
  UNIQUE (assignment_id, student_id)
);

CREATE TABLE files (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  storage_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE announcements (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  audience jsonb NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_preferences (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  notification_type text NOT NULL,
  email_enabled boolean NOT NULL DEFAULT true,
  in_app_enabled boolean NOT NULL DEFAULT true,
  UNIQUE (user_id, notification_type)
);

CREATE TABLE email_templates (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  template_key text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, template_key)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  user_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL,
  title text NOT NULL,
  body text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_logs (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  notification_id uuid REFERENCES notifications(id),
  recipient_email citext NOT NULL,
  template_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'retrying')),
  idempotency_key text NOT NULL UNIQUE,
  provider_message_id text,
  retry_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  delivered_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_students_school_status ON students(school_id, status);
CREATE INDEX idx_classes_course_status ON classes(course_id, status);
CREATE INDEX idx_enrollments_class ON enrollments(class_id, status);
CREATE INDEX idx_attendance_student_date ON attendance_records(student_id, attendance_date DESC);
CREATE INDEX idx_assignments_class_status ON assignments(class_id, status);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX idx_audit_school_time ON audit_logs(school_id, created_at DESC);
