-- Run only against the isolated local commerce_test database.
-- Idempotent fixtures: never reset existing users, courses, orders or payments.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'commerce_test' THEN
    RAISE EXCEPTION 'Commerce demo seed may only run on commerce_test';
  END IF;
END $$;

INSERT INTO users (id,email,display_name,role,external_id)
VALUES ('c0a5e001-0000-4000-8000-000000000001','commerce.lecturer.demo@codementor.test','Giảng viên Demo Commerce','lecturer','commerce-lecturer-local-demo')
ON CONFLICT (id) DO NOTHING;

-- Nếu database đã có tài khoản Lecturer E2E thì gắn fixture vào tài khoản đó để có thể
-- live-test màn hình doanh thu/danh sách học viên. Database tối giản vẫn dùng tài khoản
-- demo phía trên, nên script không phụ thuộc Keycloak và vẫn chạy lặp lại an toàn.
WITH seed_owner AS (
  SELECT COALESCE(
    (SELECT id FROM users WHERE email='lecturer1@test.local' AND role IN ('lecturer','admin') LIMIT 1),
    'c0a5e001-0000-4000-8000-000000000001'::uuid
  ) AS id
), fixtures(id,slug,title,description,level,duration_hours) AS (
  VALUES
   ('c0a5e001-0000-4000-8000-000000000101'::uuid,'demo-commerce-javascript-thuc-chien','JavaScript thực chiến từ nền tảng','Luyện JavaScript qua ví dụ ngắn và bài thực hành; phù hợp người mới bắt đầu.','basic'::current_level,12),
   ('c0a5e001-0000-4000-8000-000000000102'::uuid,'demo-commerce-cau-truc-du-lieu','Cấu trúc dữ liệu và giải thuật ứng dụng','Mảng, danh sách liên kết, cây và các mẫu giải thuật thường gặp trong phỏng vấn.','intermediate'::current_level,24),
   ('c0a5e001-0000-4000-8000-000000000103'::uuid,'demo-commerce-backend-api','Thiết kế Backend API đáng tin cậy','Xây dựng API với xác thực, kiểm thử, logging và xử lý lỗi rõ ràng.','experienced'::current_level,32)
)
INSERT INTO courses (id,slug,title,description,level,duration_hours,instructor_id,created_by,status,published_at)
SELECT fixtures.id,fixtures.slug,fixtures.title,fixtures.description,fixtures.level,fixtures.duration_hours,
       seed_owner.id,seed_owner.id,'published',now()
FROM fixtures CROSS JOIN seed_owner
ON CONFLICT (id) DO UPDATE SET
  instructor_id=EXCLUDED.instructor_id,
  created_by=EXCLUDED.created_by;

INSERT INTO course_prices (course_id,price_vnd)
VALUES
 ('c0a5e001-0000-4000-8000-000000000101',99000),
 ('c0a5e001-0000-4000-8000-000000000102',199000),
 ('c0a5e001-0000-4000-8000-000000000103',349000)
ON CONFLICT (course_id) DO NOTHING;
COMMIT;
