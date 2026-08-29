truncate
  public.school_settings,
  public.students,
  public.parents,
  public.instructors,
  public.classes,
  public.assignments,
  public.communications,
  public.notifications,
  public.audit_logs
restart identity cascade;

insert into public.school_settings (name, portal_url, settings) values
('CodeNest Academy', 'https://portal.codenest.school', '{"absenceThreshold":3,"parentAssignmentEmails":true,"dueSoonHours":24,"maxUploadMb":25}');

insert into public.students
(student_id, first_name, last_name, email, phone, date_of_birth, status, level, family, parent_name, class_id, progress, attendance, avg_grade, absences, late, notes)
values
('STU-1001', 'Maya', 'Hassan', 'maya.hassan@student.codenest.school', '+20 100 233 9911', '2012-04-18', 'Active', 'Python Foundations', 'Hassan Family', 'Nour Hassan', 'CLS-PY-A', 84, 94, 91, 1, 2, 'Strong project instincts; benefits from stretch debugging tasks.'),
('STU-1002', 'Omar', 'Saleh', 'omar.saleh@student.codenest.school', '+20 111 802 4112', '2011-09-07', 'Active', 'Web Apps', 'Saleh Family', 'Dina Saleh', 'CLS-WEB-B', 71, 87, 82, 3, 1, 'Needs follow-up on async JavaScript and project pacing.'),
('STU-1003', 'Lina', 'Farouk', 'lina.farouk@student.codenest.school', '+20 122 918 7044', '2013-01-26', 'Active', 'Scratch to Python', 'Farouk Family', 'Karim Farouk', 'CLS-SC-C', 62, 76, 78, 4, 3, 'Attendance alert triggered; parent check-in recommended.'),
('STU-1004', 'Youssef', 'Adel', 'youssef.adel@student.codenest.school', '+20 101 481 6110', '2010-12-02', 'Paused', 'Robotics', 'Adel Family', 'Salma Adel', 'CLS-ROB-A', 48, 81, 74, 2, 0, 'Paused for exam month; resume plan needed.');

insert into public.parents (name, email, children, preference, status) values
('Nour Hassan', 'nour.hassan@example.com', array['Maya Hassan'], 'Email + in-app', 'Active'),
('Dina Saleh', 'dina.saleh@example.com', array['Omar Saleh'], 'Email', 'Invited'),
('Karim Farouk', 'karim.farouk@example.com', array['Lina Farouk'], 'Email + SMS', 'Active'),
('Salma Adel', 'salma.adel@example.com', array['Youssef Adel'], 'Email', 'Active');

insert into public.instructors (name, email, classes, status) values
('Amina Nabil', 'amina@codenest.school', array['Python Beginners - Group A'], 'Active'),
('Mostafa Kamal', 'mostafa@codenest.school', array['Web Apps - Group B'], 'Active'),
('Heba Sami', 'heba@codenest.school', array['Scratch Creators - Group C'], 'Active');

insert into public.classes (class_id, name, course, instructor, student_count, schedule, room, status, completion) values
('CLS-PY-A', 'Python Beginners - Group A', 'Python Programming', 'Amina Nabil', 14, 'Mon/Wed 5:00 PM', 'Lab 2', 'Active', 58),
('CLS-WEB-B', 'Web Apps - Group B', 'Frontend Web Apps', 'Mostafa Kamal', 12, 'Tue/Thu 6:00 PM', 'Lab 1', 'Active', 46),
('CLS-SC-C', 'Scratch Creators - Group C', 'Scratch to Python', 'Heba Sami', 16, 'Sat 11:00 AM', 'Studio', 'Active', 32),
('CLS-ROB-A', 'Robotics - Group A', 'Robotics Lab', 'Amina Nabil', 8, 'Fri 2:00 PM', 'Maker Room', 'Paused', 41);

insert into public.assignments (title, course, class_name, due_date, status, submissions, total, max_grade, difficulty) values
('Build a Number Guessing Game', 'Python Programming', 'Python Beginners - Group A', '2026-08-28', 'Published', 9, 14, 100, 'Core'),
('Responsive Portfolio Page', 'Frontend Web Apps', 'Web Apps - Group B', '2026-08-26', 'Published', 5, 12, 100, 'Stretch'),
('Sprite Storyboard', 'Scratch to Python', 'Scratch Creators - Group C', '2026-08-30', 'Draft', 0, 16, 50, 'Intro');

insert into public.communications (type, recipient, subject, display_time, status) values
('Assignment', 'Python Beginners - Group A', 'New assignment published', 'Today 10:15', 'Delivered'),
('Attendance', 'Karim Farouk', 'Attendance warning for Lina Farouk', 'Yesterday 18:30', 'Opened'),
('Announcement', 'All families', 'September schedule update', 'Aug 21, 2026', 'Queued'),
('Welcome', 'Dina Saleh', 'Parent portal activation', 'Aug 20, 2026', 'Failed retrying');

insert into public.notifications (type, title, display_time, unread) values
('Attendance warning', 'Lina Farouk reached the absence threshold', '12 min ago', true),
('Submission', '5 portfolios are ready for grading', '46 min ago', true),
('Payment', '3 invoices are overdue', '2 hr ago', false),
('System', 'Email retry queue has 1 failed delivery', 'Yesterday', false);

insert into public.audit_logs (actor, action, entity, display_time, meta) values
('Sara Admin', 'student.created', 'STU-1004', '2026-08-23 12:13', 'Activation link generated'),
('Amina Nabil', 'assignment.published', 'Build a Number Guessing Game', '2026-08-23 10:14', 'Parent notifications enabled'),
('System', 'notification.retry_scheduled', 'email-log-8831', '2026-08-22 09:42', 'Attempt 2 of 5'),
('Mostafa Kamal', 'grade.updated', 'Omar Saleh', '2026-08-21 17:20', 'Score changed from 78 to 82');
