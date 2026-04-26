const MASTER_PERMISSION_GROUPS = [
  {
    key: 'clients',
    label: 'Client Master',
    permissions: [
      { key: 'clients.view', label: 'View' },
      { key: 'clients.create', label: 'Add' },
      { key: 'clients.edit', label: 'Edit' },
      { key: 'clients.delete', label: 'Delete' },
      { key: 'clients.import', label: 'Import' }
    ]
  },
  {
    key: 'timesheet_masters',
    label: 'Timesheet Masters',
    permissions: [
      { key: 'timesheets.masters.view', label: 'View' },
      { key: 'timesheets.masters.create', label: 'Add' },
      { key: 'timesheets.masters.edit', label: 'Edit' },
      { key: 'timesheets.masters.delete', label: 'Delete' },
      { key: 'timesheets.masters.import', label: 'Import' }
    ]
  },
  {
    key: 'staff',
    label: 'User Master',
    permissions: [
      { key: 'staff.view', label: 'View' },
      { key: 'staff.create', label: 'Add' },
      { key: 'staff.edit', label: 'Edit' },
      { key: 'staff.delete', label: 'Delete' },
      { key: 'access.manage', label: 'Access' }
    ]
  },
  {
    key: 'firm',
    label: 'Firm Shell',
    permissions: [
      { key: 'firm.dashboard.view', label: 'Firm Dashboard' },
      { key: 'modules.view', label: 'Go to Module' }
    ]
  }
];

const APP_PERMISSION_GROUPS = [
  ...MASTER_PERMISSION_GROUPS,
  {
    key: 'feedback',
    label: 'Feedback',
    permissions: [
      { key: 'feedback.view', label: 'View Reports' }
    ]
  },
  {
    key: 'timesheets',
    label: 'Timesheets',
    permissions: [
      { key: 'timesheets.view_own', label: 'View Own' },
      { key: 'timesheets.create_own', label: 'Add Own' },
      { key: 'timesheets.edit_own', label: 'Edit Own' },
      { key: 'timesheets.delete_own', label: 'Delete Own' },
      { key: 'timesheets.submit_own', label: 'Submit Own' },
      { key: 'timesheets.view_all', label: 'View All' }
    ]
  },
  {
    key: 'approvals',
    label: 'Approvals',
    permissions: [
      { key: 'approvals.view_manager_queue', label: 'Manager Queue' },
      { key: 'approvals.approve_manager', label: 'Manager Approve' },
      { key: 'approvals.view_partner_queue', label: 'Partner Queue' },
      { key: 'approvals.approve_partner', label: 'Partner Approve' }
    ]
  },
  {
    key: 'reports',
    label: 'Reports',
    permissions: [
      { key: 'reports.view', label: 'View Reports' },
      { key: 'reports.export', label: 'Export' }
    ]
  },
  {
    key: 'attendance',
    label: 'Attendance',
    permissions: [
      { key: 'attendance.view_own', label: 'View Own' },
      { key: 'attendance.create_own', label: 'Check In/Out' },
      { key: 'attendance.view_reports', label: 'View Reports' },
      { key: 'attendance.approve_corrections', label: 'Approve Corrections' }
    ]
  },
  {
    key: 'dashboard',
    label: 'Dashboard',
    permissions: [
      { key: 'dashboard.view_self', label: 'Self View' },
      { key: 'dashboard.view_team', label: 'Team View' },
      { key: 'dashboard.view_firm', label: 'Firm View' }
    ]
  }
];

const ALL_MASTER_PERMISSIONS = MASTER_PERMISSION_GROUPS.flatMap(group =>
  group.permissions.map(permission => permission.key)
);

const ALL_APP_PERMISSIONS = APP_PERMISSION_GROUPS.flatMap(group =>
  group.permissions.map(permission => permission.key)
);

function normalizePermissionArray(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.filter(Boolean))];
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return normalizePermissionArray(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

function parsePermissions(value) {
  return normalizePermissionArray(value);
}

function serializePermissions(value) {
  return JSON.stringify(normalizePermissionArray(value));
}

function getDefaultPermissions(role) {
  if (role === 'partner') {
    return [...ALL_APP_PERMISSIONS];
  }
  if (role === 'manager') {
    return [
      'clients.view',
      'timesheets.masters.view',
      'staff.view',
      'modules.view',
      'firm.dashboard.view',
      'timesheets.view_own',
      'timesheets.create_own',
      'timesheets.edit_own',
      'timesheets.delete_own',
      'timesheets.submit_own',
      'timesheets.view_all',
      'approvals.view_manager_queue',
      'approvals.approve_manager',
      'reports.view',
      'reports.export',
      'attendance.view_own',
      'attendance.create_own',
      'attendance.view_reports',
      'attendance.approve_corrections',
      'dashboard.view_self',
      'dashboard.view_team'
    ];
  }
  return [
    'clients.view',
    'modules.view',
    'timesheets.view_own',
    'timesheets.create_own',
    'timesheets.edit_own',
    'timesheets.delete_own',
    'timesheets.submit_own',
    'attendance.view_own',
    'attendance.create_own',
    'dashboard.view_self'
  ];
}

function ensurePermissions(value, role) {
  const normalized = normalizePermissionArray(value);
  const permissions = normalized.length ? normalized : getDefaultPermissions(role);
  return permissions.includes('firm.dashboard.view')
    ? permissions
    : [...permissions, 'firm.dashboard.view'];
}

function hasPermission(user, permission) {
  if (!user) return false;
  const permissions = ensurePermissions(user.permissions, user.role);
  return permissions.includes(permission);
}

module.exports = {
  MASTER_PERMISSION_GROUPS,
  APP_PERMISSION_GROUPS,
  ALL_MASTER_PERMISSIONS,
  ALL_APP_PERMISSIONS,
  parsePermissions,
  serializePermissions,
  getDefaultPermissions,
  ensurePermissions,
  hasPermission
};
