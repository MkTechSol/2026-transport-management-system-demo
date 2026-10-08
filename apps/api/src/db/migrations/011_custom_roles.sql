-- Custom roles created by the super admin. Built-in roles stay in code (packages/shared); a custom role carries its own
-- permission list and borrows workflow behaviour (trip steps, approvals, notifications, own-data scoping) from `based_on`.
CREATE TABLE custom_roles (
  code        varchar(30) PRIMARY KEY,
  name        varchar(60) NOT NULL UNIQUE,
  description varchar(250),
  based_on    varchar(30) NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}',
  created_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
